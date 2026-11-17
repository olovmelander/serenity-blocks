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
    atan,
    clamp,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    int,
    length,
    log,
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
import { BRAID, TAU } from './sunbraid-core.js';

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
 * Voronoi cells and their borders at a point (in cell units, centres jittered by `jitter`):
 * `edge`, the true distance to the nearest border (each border is the bisector of two centres);
 * `id` and `other` (0..1), the cell the point lies in and the cell across that border; `soft`, a
 * smooth minimum of the distances to all its borders (they merge `knot` round where they meet), and
 * `lean`, its gradient's direction (toward the borders, shorter than 1 where they meet);
 * `centre`, the way from the point to its cell's centre (cell units). The
 * smooth minimum takes every border at once: a minimum of the nearest two jumped wherever a third
 * came as near (two corners close together), and the junctions flickered as the eye moved. The
 * borders are sought among the same nine centres as the nearest one: within 0.3 cells of a border
 * that agrees with a 5 × 5 search at jitter 0.85 (all but 7 points in a million). An inline builder
 * (it gives several values): call it inside a Fn.
 */
export function sbCellEdge(p, jitter, knot) {
    const ip = floor(p).toVar();
    const fp = fract(p).toVar();
    const sites = [];
    const near = vec2(0.0).toVar();
    const nearD = float(8.0).toVar();
    const id = float(0.0).toVar();
    for (let j = -1; j <= 1; j += 1) {
        for (let i = -1; i <= 1; i += 1) {
            const o = vec2(i, j);
            const h = sbHash22(ip.add(o)).toVar();
            const r = o.add(h.sub(0.5).mul(jitter)).add(0.5).sub(fp).toVar();
            sites.push({ r, id: h.x });
            const d = dot(r, r);
            const nearer = d.lessThan(nearD);
            near.assign(select(nearer, r, near));
            id.assign(select(nearer, h.x, id));
            nearD.assign(min(nearD, d));
        }
    }
    const edge = float(8.0).toVar();
    const other = float(0.0).toVar();
    const weight = float(0.0).toVar();
    const pull = vec2(0.0).toVar();
    for (const site of sites) {
        const apart = site.r.sub(near);
        const span = length(apart);
        const dir = apart.div(max(span, 1e-5));
        // The nearest centre itself (span 0) has no border with the point's cell.
        const b = select(span.greaterThan(1e-4), dot(near.add(site.r).mul(0.5), dir), float(8.0)).toVar();
        other.assign(select(b.lessThan(edge), site.id, other));
        edge.assign(min(edge, b));
        const w = exp(b.div(knot).negate());
        weight.addAssign(w);
        pull.addAssign(dir.mul(w));
    }
    const held = max(weight, 1e-30);
    return {
        edge, id, other, soft: log(held).mul(knot).negate(), lean: pull.div(held), centre: near,
    };
}

export const sbLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/**
 * The suns as seen: the disc's white-hot core and its limb in the sun's own colour (linear, times
 * the light's colour normalised), the tight halo's strength; the slow grain in the disc's heart
 * (its depth, and the baked noise's size across a disc), and the thin atmosphere of the sun's
 * colour round its limb (its light, and how fast it falls off in disc radii).
 */
export const SUN_LOOK = Object.freeze({
    core: 6.0, rim: 3.0, halo: 0.05, grain: 0.34, grainSize: 0.11, air: 1.1, airFall: 9,
});

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
    // (The high cloud's fibres are read at a grazing angle: a long thin footprint.)
    tex.anisotropy = 8;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'sunbraid-noise';
    tex.needsUpdate = true;
    return tex;
}

// ── The scene's state ─────────────────────────────────────────────────────────────

/** Most pulses of light in the crust at once (two rows each). */
export const MAX_PULSES = 20;

export function createUniforms() {
    const casterRows = Array.from({ length: MAX_CASTERS * 2 }, () => new THREE.Vector4(0, -1e5, 0, 0));
    // (At rest as PulseTable.write leaves a spent pulse: a ring nowhere, no light.)
    const pulseRows = Array.from({ length: MAX_PULSES * 2 }, (_, i) => (
        i % 2 ? new THREE.Vector4(0, 0, 0, 0) : new THREE.Vector4(0, 0, -1e5, 1)));
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
        // The weather (sunbraid-weather.js), written every frame: the high ice cloud, the banks
        // along the rim, the ice veil, the shower under the banks, and how dark a cloud's shadow
        // lies on the land.
        cirrus: uniform(0.34),
        banks: uniform(0.16),
        veil: uniform(0),
        rain: uniform(0),
        cloudShade: uniform(0.16),
        /** The cirrus streets' own axes on the ground (unit vectors, xz): along the wind and across it. */
        windAlong: uniform(new THREE.Vector2(-0.454, -0.891)),
        windAcross: uniform(new THREE.Vector2(0.891, -0.454)),
        /** How far the high cloud has run along its streets (metres) and the banks along the rim (turns). */
        cirrusDrift: uniform(0),
        bankDrift: uniform(0),
        // The braid's own frame in the sky: the cluster's centre, east and north of it (unit
        // vectors), where the braid stands (radians, wrapped) and the tangent of its radius.
        centre: uniform(new THREE.Vector3(-0.45, 0.16, -0.88).normalize()),
        east: uniform(new THREE.Vector3(0.89, 0, -0.45).normalize()),
        north: uniform(new THREE.Vector3(0, 1, 0)),
        braidAngle: uniform(0),
        braidRadius: uniform(0.084),
        /** A pillar of light over each sun (the ice veil; a perfect clear): 0 none .. 1 full. */
        pillar: uniform(0),
        /** The rings round the suns (a perfect clear; a ghost of them in the veil) and their radius (radians). */
        halo: uniform(0),
        haloRadius: uniform(0.15),
        /** A chain's spiral arms: their strength, and how far out they reach (in braid radii). */
        arms: uniform(0),
        armReach: uniform(1),
        /** The one white sun's rays (four lines), and how far they have turned (texture turns). */
        rays: uniform(0),
        rayTurn: uniform(0),
        /** The moon: its direction and the cosine of its radius; how much of it shows (0 hidden .. 1). */
        moon: uniform(new THREE.Vector4(0, -1, 0, 0.9996)),
        moonSeen: uniform(0),
        /** The stars (game over's dusk): 0 none .. 1 full. */
        stars: uniform(0),
        // The lens (unit vectors: right, up, ahead), and where each sun's disc and the moon's
        // stand in its image plane (x, y in tangent units from the view axis; their radius there):
        // the discs are drawn round a point of the picture, so they are round wherever they stand.
        lensRight: uniform(new THREE.Vector3(1, 0, 0)),
        lensUp: uniform(new THREE.Vector3(0, 1, 0)),
        lensAhead: uniform(new THREE.Vector3(0, 0, -1)),
        disc0: uniform(new THREE.Vector3(0, 0, 0.02)),
        disc1: uniform(new THREE.Vector3(0, 0, 0.02)),
        disc2: uniform(new THREE.Vector3(0, 0, 0.02)),
        moonAt: uniform(new THREE.Vector3(0, 9, 0.03)),
        /** How far the grain in the suns' discs has turned (texture units). */
        sunTurn: uniform(new THREE.Vector2(0, 0)),
        // The suns' light on the land as it is in colour (sat) and as the one white sun gives it
        // (pale): four lines drain the colour everywhere, and it floods back behind a front that
        // crosses the valley from `flood` (x, z; the front's radius; how soft its edge is, metres).
        sat0: uniform(new THREE.Vector3(1, 0.27, 0.13)),
        sat1: uniform(new THREE.Vector3(0.16, 1, 0.4)),
        sat2: uniform(new THREE.Vector3(0.2, 0.36, 1)),
        pale0: uniform(new THREE.Vector3(1, 1, 1)),
        pale1: uniform(new THREE.Vector3(1, 1, 1)),
        pale2: uniform(new THREE.Vector3(1, 1, 1)),
        whiteLand: uniform(0),
        flood: uniform(new THREE.Vector4(0, 0, 0, 400)),
        // Pulses of light in the crust (a lock, a clear, the colour's front): per pulse
        // (x, z, radius, width) and (r, g, b, how far its colour splits into the three suns').
        pulses: uniformArray(pulseRows, 'vec4'),
        pulseCount: uniform(0, 'int'),
        pulseRows,
        /** The film of water on the plain (0 dry .. 1 flooded) and how far its ripples have run. */
        wet: uniform(0),
        rippleDrift: uniform(new THREE.Vector2(0, 0)),
        /** The dust streamers: how strong (0..1), the ground wind's axes (xz) and how far it has blown (m). */
        wind: uniform(0.2),
        gustAlong: uniform(new THREE.Vector2(0.94, -0.34)),
        gustAcross: uniform(new THREE.Vector2(0.34, 0.94)),
        gustDrift: uniform(0),
        /** A level-up's light climbing the towers: seconds since it began (negative: none). */
        wake: uniform(-1),
        /** The set suns' afterglow on the land (nothing by day): it keeps the crust legible at dusk. */
        afterglow: uniform(new THREE.Vector3(0, 0, 0)),
        eye: uniform(new THREE.Vector3(0, 5, 0)),
        groundY: uniform(0),
        exposureInv: uniform(1),
        casters: uniformArray(casterRows, 'vec4'),
        casterCount: uniform(0, 'int'),
        /** How many of the rows are the towers (solid stone): what a mirror and the mist's wedges read. */
        solidCount: uniform(0, 'int'),
        casterRows,
        // The gliders' shadows: a disc each (centre x, y, z; radius), written every frame.
        gliders: uniformArray(gliderRows, 'vec4'),
        gliderCount: uniform(0, 'int'),
        gliderRows,
    };
}

/**
 * Write the caster list into the rows (cylinder axis x, foot y0, axis z, radius; then top y1 and
 * how much of a sun's light it lets past: 0 for stone). The towers come first; the world adds what
 * moves (a twister) after them each frame.
 */
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
    u.solidCount.value = n;
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

/**
 * Each sun's visibility at a world point, past every tower and glider (and the high cloud): vec3 (coral, jade,
 * cobalt). One loop over the casters, the three suns per caster. `own` (first row, how many: a
 * tower's own cylinders) leaves those rows out: a tower's stone is shaded by its own faces and its
 * sculpt's occlusion, and a face set back inside its tier's cylinder would stand in that
 * cylinder's shade.
 */
export function sunVisibility(u, P, noise = null, own = null) {
    const v0 = float(1.0).toVar();
    const v1 = float(1.0).toVar();
    const v2 = float(1.0).toVar();
    Loop({
        start: int(0), end: u.casterCount, type: 'int', condition: '<', name: 'cst',
    }, ({ cst }) => {
        const ra = u.casters.element(cst.mul(2)).toVar();
        const rb = u.casters.element(cst.mul(2).add(1)).toVar();
        // (rb.y: how much light the caster lets past. Stone none; a column of dust most of it;
        // a tower's own cylinders all of it, for its own stone.)
        const row = float(cst);
        const pass = own
            ? select(row.greaterThanEqual(own.x).and(row.lessThan(own.x.add(own.y))), float(1.0), rb.y).toVar()
            : rb.y;
        v0.assign(min(v0, mix(sbCylinderVis(P, u.sun0, ra, rb.x, u.penumbra.x), 1.0, pass)));
        v1.assign(min(v1, mix(sbCylinderVis(P, u.sun1, ra, rb.x, u.penumbra.y), 1.0, pass)));
        v2.assign(min(v2, mix(sbCylinderVis(P, u.sun2, ra, rb.x, u.penumbra.z), 1.0, pass)));
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
export function sunLight(u, N, vis, wrap = 0, suns = null) {
    const k = 1 / (1 + wrap);
    const l0 = max(dot(N, u.sun0).add(wrap).mul(k), 0.0).mul(vis.x);
    const l1 = max(dot(N, u.sun1).add(wrap).mul(k), 0.0).mul(vis.y);
    const l2 = max(dot(N, u.sun2).add(wrap).mul(k), 0.0).mul(vis.z);
    const c = suns || { c0: u.col0, c1: u.col1, c2: u.col2 };
    return c.c0.mul(l0).add(c.c1.mul(l1)).add(c.c2.mul(l2));
}

/**
 * The three suns' light on the land at a world point: in colour behind the front that four lines'
 * release sends across the valley, the one white sun's light ahead of it. An inline builder: call
 * it inside a Fn, before any branch (its values are pinned).
 */
export function landSuns(u, P) {
    const away = length(P.xz.sub(u.flood.xy));
    const white = u.whiteLand.mul(smoothstep(u.flood.z.sub(u.flood.w), u.flood.z, away)).toVar();
    return {
        c0: mix(u.sat0, u.pale0, white).toVar(),
        c1: mix(u.sat1, u.pale1, white).toVar(),
        c2: mix(u.sat2, u.pale2, white).toVar(),
        white,
    };
}

/**
 * The pulses of light in the crust at a point (`tile`: the centre of the crust's cell there, so a
 * whole tile lights as one): each a ring that spreads from where it was struck. A pulse written
 * with a negative width lights the crust's ridges alone (light running along the cracks: a lock's
 * ripple, which must never flood the floor beside the board); the others light the tiles' faces
 * too. Returns the light for the faces and for the ridges, and how much of each they take. A
 * pulse whose colour "splits" runs coral at its leading edge, jade in its middle and cobalt
 * behind: white light come apart. An inline builder (it loops): call it inside a Fn.
 */
export function crustPulses(u, tile) {
    const fill = vec3(0.0).toVar();
    const edge = vec3(0.0).toVar();
    const coverFill = float(0.0).toVar();
    const coverEdge = float(0.0).toVar();
    Loop({
        start: int(0), end: u.pulseCount, type: 'int', condition: '<', name: 'pls',
    }, ({ pls }) => {
        const a = u.pulses.element(pls.mul(2)).toVar();
        const b = u.pulses.element(pls.mul(2).add(1)).toVar();
        const q = length(tile.sub(a.xy)).sub(a.z).div(max(abs(a.w), 1.0)).toVar();
        // (A bounded bell: 1 on the ring, 0 a width and a half either side of it.)
        const fall = max(float(1.0).sub(q.mul(q).mul(0.444)), 0.0);
        const ring = fall.mul(fall).toVar();
        const power = sbMax3(b.xyz).toVar();
        const spectrum = clamp(vec3(1.5).sub(abs(vec3(q.mul(1.5)).add(vec3(-1.15, 0.0, 1.15)))), 0.0, 1.0);
        const light = mix(b.xyz, spectrum.mul(power), b.w).mul(ring).toVar();
        const faces = step(0.0, a.w);
        fill.addAssign(light.mul(faces));
        edge.addAssign(light);
        coverFill.addAssign(ring.mul(min(power, 1.0)).mul(faces));
        coverEdge.addAssign(ring.mul(min(power, 1.0)));
    });
    return {
        fill, edge, coverFill, coverEdge,
    };
}

// ── The sky ───────────────────────────────────────────────────────────────────────

/**
 * The sky's look. Angles are radians; a sun's "tightness" k draws e^(−k(1 − μ)), a Gaussian of the
 * angle from it with σ = 1/√k.
 *  - climb: how fast the horizon's colour gives way to the zenith's with height (the lens sees
 *    only the lowest 18° of the dome: the gradient has to turn inside them);
 *  - venn: each sun's soft disc of glow, a few degrees wide: they overlap into the sums of their
 *    colours (gold, cyan, magenta, white in the middle), the same sums the shadows are made of;
 *  - pillar: a sun's pillar of light in the ice veil: its width (1/σ² of the sine of the bearing
 *    off the sun), how fast it fades above and below the sun, its gain;
 *  - halo: the ring round a sun: its width inside and outside the radius, its gain;
 *  - arms: a chain's spiral arms: how tightly they wind (radians per e-fold of radius), their
 *    width at the sun and how it grows outward, how far they reach, their gain, and how narrow
 *    the bright thread down the middle of each is (of the arm's width);
 *  - rays: the one white sun's rays: lobes round the circle, their reach (radians), gain;
 *  - cirrus: the high ice cloud: its height (m), a street's length and width (m), the bend of its
 *    fibres, the range it fades over (m), its sunlit gain and its own pale fill;
 *  - banks: the cloud banks along the rim: how high the tallest stand (radians), the crown's lit
 *    band (radians), how far they keep off the suns' bearing, how many round heads stand to a
 *    radian of the rim and how high one stands (radians), how soft the skyline's edge is;
 *  - mesas: the far tablelands beyond the valley's rim: how many benches their heights step
 *    in, how high the tallest stand (radians) and how much of the noise lies under the horizon
 *    (only the tallest lumps stand over the valley's own rim), the lit thread along their tops,
 *    their beds (lines to a radian of height) and how dark a bed is;
 *  - stars: cells per radian, the share of cells that hold one, their gain.
 */
export const SKY_LOOK = Object.freeze({
    climb: 5.2,
    venn: Object.freeze({ tight: 360, gain: 0.075 }),
    pillar: Object.freeze({
        tight: 3000, up: 7.0, down: 15, gain: 0.34,
    }),
    halo: Object.freeze({ inner: 0.006, outer: 0.02, gain: 0.3 }),
    arms: Object.freeze({
        wind: 2.2, width: 0.02, flare: 0.16, reach: 2.4, gain: 0.3, core: 0.4, end: 3.5,
    }),
    rays: Object.freeze({ lobes: 3, reach: 0.34, gain: 0.5 }),
    cirrus: Object.freeze({
        height: 7200, along: 46000, across: 3400, bend: 0.11, fade: 120000, lit: 0.34, fill: 0.5,
    }),
    banks: Object.freeze({
        rise: 0.3, crown: 0.02, keepOff: 0.86, heads: 2.3, head: 0.016, soft: 0.009,
    }),
    mesas: Object.freeze({
        benches: 7, rise: 0.13, floor: 0.4, rim: 0.0022, beds: 300, bed: 0.07,
    }),
    stars: Object.freeze({ cells: 74, share: 0.2, gain: 2.6 }),
});

/**
 * A Henyey–Greenstein lobe (normalised to 1 at mu = 1 for g → 1 shapes alike), written with a
 * guarded base so it never takes the power of a negative.
 */
function lobe(mu, g) {
    const gg = g * g;
    const k = (1 + gg - 2 * g) ** 1.5 / (1 - gg);
    return float(1 - gg).div(pow(max(float(1 + gg).sub(mu.mul(2 * g)), 1e-4), 1.5)).mul(k);
}

/** The angle from a direction whose cosine is `mu` (small angles: √(2(1 − μ)), no acos). */
const angleOf = (mu) => max(float(1.0).sub(mu), 0.0).mul(2.0).sqrt();

/**
 * One sun's light in the sky along a direction: a broad lobe that tints the whole dome (no part of
 * the sky is ever without it), the glow along the horizon on its side, a tight corona, and the
 * disc — a white-hot core with a limb of the sun's own colour. A laid-out function (the dome, the
 * haze and the wet plain's mirror each call it three times: inlined, the land's shader carried six
 * copies of it).
 */
export const sbSunSky = /* @__PURE__ */ Fn(([dirIn, sunDir, sunCol, sunGlow, shareIn, discCosIn, upIn, blazeIn]) => {
    const mu = clamp(dot(dirIn, sunDir), -1.0, 1.0).toVar();
    const flatDir = normalize(vec3(dirIn.x, 0.0, dirIn.z).add(vec3(1e-5, 0.0, 0.0)));
    const flatSun = normalize(vec3(sunDir.x, 0.0, sunDir.z).add(vec3(1e-5, 0.0, 0.0)));
    const toward = dot(flatDir, flatSun).mul(0.5).add(0.5);
    const t2 = toward.mul(toward);
    const band = exp(upIn.mul(-5.5));
    const horizonGlow = t2.mul(t2).mul(band).mul(shareIn).mul(0.085);
    const broad = lobe(mu, 0.35).mul(0.012);
    // The corona: a tight bright halo in the sun's own colour, falling off fast (a star seen through
    // clean air), then a broad faint one; the old pair was a wide soft wash round each disc.
    // (The heat of play blazes the tight halo only: a broad wash would whiten the sky round the suns.)
    const corona = lobe(mu, 0.86).mul(0.035)
        .add(lobe(mu, 0.975).mul(0.05).add(lobe(mu, 0.996).mul(SUN_LOOK.halo)).mul(blazeIn));
    // `across` is (1 − mu) over the disc's (1 − cos r): it runs as the square of the angle, so
    // sqrt(across) is the distance from the centre in disc radii.
    const across = float(1.0).sub(mu).div(max(float(1.0).sub(discCosIn), 1e-7));
    const rad = across.max(0.0).sqrt().toVar();
    const discMask = smoothstep(1.04, 0.96, rad);
    // Limb darkening toward the sun's own colour at the edge (a star's rim is cooler than its heart).
    const limb = smoothstep(0.25, 1.0, rad);
    const hue = sunCol.div(max(max(sunCol.x, max(sunCol.y, sunCol.z)), 1e-3));
    const discLight = mix(vec3(SUN_LOOK.core), hue.mul(SUN_LOOK.rim), limb).mul(discMask);
    return sunGlow.mul(horizonGlow.add(broad)).add(sunCol.mul(corona)).add(discLight);
}).setLayout({
    name: 'sb_sunSky',
    type: 'vec3',
    inputs: [
        { name: 'dirIn', type: 'vec3' }, { name: 'sunDir', type: 'vec3' }, { name: 'sunCol', type: 'vec3' },
        { name: 'sunGlow', type: 'vec3' }, { name: 'shareIn', type: 'float' }, { name: 'discCosIn', type: 'float' },
        { name: 'upIn', type: 'float' }, { name: 'blazeIn', type: 'float' },
    ],
});

/**
 * The lens's image plane: where a direction lands on the frame, in tangent units from the view
 * axis (right, up). A disc drawn round a point of it is round on the screen wherever it stands:
 * drawn round a direction of the SKY, a sun 30° off the axis came out an egg (a rectilinear lens
 * stretches whatever lies off its axis).
 */
function lensPlane(u, dir) {
    return vec2(dot(dir, u.lensRight), dot(dir, u.lensUp)).div(max(dot(dir, u.lensAhead), 0.05));
}

/**
 * One sun in the dome as the eye sees it: sbSunSky's light, and with `extras` (the dome itself,
 * not the haze's or a mirror's read of it) its disc drawn in the lens's image plane (`at`: its
 * centre there and its radius; `plane`: where this sight line lands) with a grain turning slowly
 * in it and a thin atmosphere round its limb, its soft disc of glow, its pillar in the ice veil
 * and its ring.
 */
function sunInSky(u, dir, S, C, G, share, discCos, up, extras, at = null, plane = null, noise = null, k = 0) {
    if (!extras) return sbSunSky(dir, S, C, G, share, discCos, up, u.blaze);
    // (The laid-out function draws no disc here: 2 is past any cosine.)
    const light = sbSunSky(dir, S, C, G, share, float(2.0), up, u.blaze);
    const L = SKY_LOOK;
    const mu = clamp(dot(dir, S), -1.0, 1.0).toVar();
    const flatDir = normalize(vec3(dir.x, 0.0, dir.z).add(vec3(1e-5, 0.0, 0.0))).toVar();
    const flatSun = normalize(vec3(S.x, 0.0, S.z).add(vec3(1e-5, 0.0, 0.0))).toVar();
    const facing = dot(flatDir, flatSun);
    const Cn = C.div(max(max(C.x, max(C.y, C.z)), 1e-3)).toVar();
    // The disc, round on the screen: a white-hot heart with a slow grain in it, darkening to the
    // sun's own colour at the limb, and a thin atmosphere of that colour just outside it.
    const D = SUN_LOOK;
    const inDisc = plane.sub(at.xy).div(max(at.z, 1e-5)).toVar();
    const rad = length(inDisc).toVar();
    const discMask = smoothstep(1.04, 0.96, rad).mul(step(0.0, dot(dir, u.lensAhead)));
    const limb = smoothstep(0.25, 1.0, rad);
    const grainAt = inDisc.mul(D.grainSize).add(vec2(0.37 * k + 0.11, 0.19 * k)).add(u.sunTurn);
    const grain = texture(noise, grainAt).bias(0.6).b;
    const heart = vec3(D.core).mul(grain.sub(0.5).mul(D.grain).add(1.0));
    const air = exp(rad.sub(1.0).max(0.0).mul(-D.airFall)).mul(smoothstep(0.96, 1.04, rad)).mul(D.air);
    const discLight = mix(heart, Cn.mul(D.rim), limb).mul(discMask).add(Cn.mul(air));
    // Its soft disc of glow: three of them overlap round the triple star into the sums of their
    // colours, as the shadows do on the floor.
    const off = float(1.0).sub(mu);
    const venn = exp(off.mul(-L.venn.tight)).mul(L.venn.gain);
    // Its pillar: a column of light through the sun in the ice veil, as wide as the disc, taller
    // above the sun than below it. (The sine of the bearing off the sun; ahead of the eye only.)
    const side = flatDir.x.mul(flatSun.z).sub(flatDir.z.mul(flatSun.x)).toVar();
    const rise = dir.y.sub(S.y).toVar();
    const fall = select(rise.greaterThan(0.0), rise.mul(-L.pillar.up), rise.mul(L.pillar.down));
    const column = exp(side.mul(side).mul(-L.pillar.tight).add(fall)).mul(step(0.0, facing))
        .mul(u.pillar.mul(L.pillar.gain));
    // Its ring: sharp inside, soft outside, as a ring of ice light is.
    const away = angleOf(mu).sub(u.haloRadius).toVar();
    const width = select(away.lessThan(0.0), float(L.halo.inner), float(L.halo.outer));
    const ringAt = away.div(width);
    const ring = exp(ringAt.mul(ringAt).negate()).mul(u.halo.mul(L.halo.gain));
    return light.add(discLight).add(C.mul(venn.add(column))).add(Cn.mul(ring));
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

/**
 * The braid's own light round the triple star, in the plane of the lens about the cluster's
 * centre (east, and north stretched so the suns' flattened circle is round there):
 *  - a chain's spiral arms: each sun trails an arm of its own colour that winds out behind it
 *    (a logarithmic spiral through the sun), longer and brighter with the chain;
 *  - the one white sun's rays: unequal rays that turn slowly round the joined suns.
 * An inline builder: call it inside a Fn.
 */
export function braidLight(u, dir, noise) {
    const L = SKY_LOOK;
    const ahead = max(dot(dir, u.centre), 0.05).toVar();
    const p = vec2(dot(dir, u.east), dot(dir, u.north).div(BRAID.flatten)).div(ahead).toVar();
    const rho = length(p).max(1e-4).toVar();
    const phi = atan(p.y, p.x).toVar();
    const r0 = u.braidRadius.max(0.012).toVar();
    const out = rho.div(r0).toVar();
    const lag = log(out).mul(L.arms.wind).toVar();
    // An arm is as wide as its sun's glow at the sun and broadens as it winds out.
    const width = float(L.arms.width).add(rho.sub(r0).max(0.0).mul(L.arms.flare)).toVar();
    const reach = u.armReach.mul(L.arms.reach).max(0.05).toVar();
    // (They are gone by `end` braid radii: the board's card stands four radii to the right.)
    const along = smoothstep(0.8, 1.15, out).mul(exp(out.sub(1.0).max(0.0).div(reach).negate()))
        .mul(float(1.0).sub(smoothstep(L.arms.end * 0.62, L.arms.end, out)))
        .mul(step(0.0, dot(dir, u.centre)))
        .toVar();
    const armOf = (k, C) => {
        const turn = phi.sub(u.braidAngle).sub((k * TAU) / 3).add(lag).div(TAU);
        const off = fract(turn.add(0.5)).sub(0.5).mul(TAU).mul(rho)
            .div(width);
        const o2 = off.mul(off);
        // A soft sleeve of the sun's colour round a bright thread (a band of even light read as
        // a plastic hoop).
        return C.mul(exp(o2.negate()).mul(0.5).add(exp(o2.div(-L.arms.core * L.arms.core)).mul(0.6)));
    };
    const arms = armOf(0, u.col0).add(armOf(1, u.col1)).add(armOf(2, u.col2))
        .mul(along.mul(u.arms).mul(L.arms.gain));
    // The rays: lobes read round the circle from the baked noise (whole tiles round it, so the
    // circle closes), each as long as it is bright. (An explicit level: the bearing jumps a whole
    // turn across the seam, and the derivative there would pick the coarsest mip in a line.)
    const round = phi.div(TAU).toVar();
    const lump = texture(noise, vec2(round.mul(L.rays.lobes).add(u.rayTurn), 0.37)).level(0.0).r;
    const fine = texture(noise, vec2(round.mul(L.rays.lobes * 2).sub(u.rayTurn.mul(1.7)), 0.71)).level(0.0).g;
    const ray = smoothstep(0.42, 0.78, lump.mul(0.62).add(fine.mul(0.38))).toVar();
    const rayReach = ray.mul(0.8).add(0.2).mul(L.rays.reach);
    const rays = ray.mul(exp(rho.div(rayReach).negate())).mul(step(0.0, dot(dir, u.centre)))
        .mul(u.rays.mul(L.rays.gain));
    const white = u.col0.add(u.col1).add(u.col2).mul(1 / 3);
    return arms.add(white.mul(rays));
}

// ── The cloud ─────────────────────────────────────────────────────────────────────

/**
 * The high ice cloud's density (0..1) over a world point xz on its deck: long streets that run
 * along the wind, which blows toward the suns' bearing, so from the eye they fan out over the
 * valley from under the triple star. One read stretched a dozen to one along the street (long
 * fibres, no two alike), its domain bent by a slow warp; patches of it by another read; how much
 * of the sky it takes follows u.cirrus. (The patches are broad even on a clear day: a lone wisp
 * the size of a thumbnail read as a scribble on the sky.)
 */
export function cirrusDensity(u, noise, xz) {
    const C = SKY_LOOK.cirrus;
    const q = vec2(dot(xz, u.windAcross), dot(xz, u.windAlong).add(u.cirrusDrift)).toVar();
    const warp = texture(noise, q.div(vec2(C.across * 14, C.along * 0.9)).add(vec2(0.31, 0.77))).rg.sub(0.5)
        .mul(C.bend);
    const p = q.div(vec2(C.across, C.along)).add(warp).toVar();
    const fibre = texture(noise, p.mul(vec2(0.5, 1.0))).g;
    const wisp = texture(noise, p.mul(vec2(2.3, 1.7)).add(vec2(0.53, 0.19))).b;
    const patch = texture(noise, q.div(vec2(C.across * 7.5, C.along * 1.4)).add(vec2(0.17, 0.43))).r;
    // More of the sky as the weather asks: the patches widen, and the fibres fill out inside them.
    const room = smoothstep(float(0.6).sub(u.cirrus.mul(0.38)), float(0.82).sub(u.cirrus.mul(0.34)), patch);
    const body = smoothstep(0.32, 0.72, fibre.mul(0.62).add(wisp.mul(0.38)));
    return room.mul(body).mul(u.cirrus.mul(0.45).add(0.55));
}

/**
 * The high cloud's density (0..1) over a world point xz: broad drifting banks, warped, with finer
 * fleece in them; how much of the sky they cover follows u.cloudCover. (The land's cloud shadows
 * read its broad masses; the dome draws the cirrus and the banks along the rim instead: a flat
 * deck seen from the valley floor is squashed into grey dashes.)
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
    return float(1.0).sub(d.mul(u.cloudShade));
}

/** The high cloud's fill from the dome (shares of the zenith's and the horizon's colour). */
export const CLOUD_FILL = Object.freeze({ zenith: 0.55, horizon: 0.2 });

/**
 * One rank of the cloud banks along the rim, drawn on the dome itself (a skyline of heads over
 * the bearing): returns how much of the sight line it covers and its light. `scale` the heads'
 * size along the rim, `row` its row of the noise, `lift` how tall it stands (of the tallest),
 * `shade` how dusky its body is (a nearer rank stands darker against a farther one). The skyline
 * is a broad smooth swell with round heads riding on it: half-circles side by side (their size
 * and place pushed about by the swell), so the tops are round and the creases between them point
 * down. (A folded noise gave a sawtooth with a comb of streaks under it: a waveform, not a cloud.)
 * A head is bright at its crown and dusky toward its flat base, and its flank toward the suns
 * takes their light. Its colours are the sky's own behind it.
 */
function bankRank(u, noise, dir, az, keep, glow, behind, flank, scale, row, lift, shade) {
    const B = SKY_LOOK.banks;
    const along = az.mul(scale).add(u.bankDrift.mul(scale)).toVar();
    const swell = texture(noise, vec2(along.mul(0.2), row)).level(0.0).r.toVar();
    const roll = texture(noise, vec2(along.mul(0.5), row + 0.29)).level(0.0).r;
    // Round heads: where along a head this bearing stands (−1..1), its half-circle's height.
    const head = fract(along.mul(B.heads).add(swell.mul(3.0))).mul(2.0).sub(1.0);
    const dome = float(1.0).sub(head.mul(head)).max(0.0).sqrt();
    // The skyline: the heads stand taller as the weather builds, and keep off the suns' bearing.
    const build = u.banks.mul(0.6).sub(0.52);
    const top = swell.mul(0.62).add(roll.mul(0.34)).add(build).mul(B.rise * lift)
        .mul(keep)
        .add(dome.mul(B.head * lift))
        .toVar();
    const under = top.sub(dir.y).toVar();
    const cover = smoothstep(0.0, B.soft, under).mul(smoothstep(0.0, 0.004, top));
    // Inside the bank: soft puffs (read blurred: the fine octaves broke them into flat patches),
    // lit on the flank that faces the suns (the same field read a step toward them: a low gain
    // round a mid value).
    const at = vec2(along.mul(1.1), dir.y.mul(4.2).add(row)).toVar();
    const puff = texture(noise, at).bias(2.0).r.toVar();
    const sunward = texture(noise, at.add(vec2(flank.mul(0.03), 0.012))).bias(2.0).r;
    const lit = clamp(puff.sub(sunward).mul(2.2).add(0.5), 0.0, 1.0);
    // Bright toward the crown, dusky toward the flat base (where the rim's haze takes it).
    const height = clamp(dir.y.div(max(top, 0.012)), 0.0, 1.0);
    const crown = exp(under.max(0.0).div(-B.crown));
    const dusk = behind.mul(shade);
    const bright = behind.mul(1.08).add(glow.mul(0.5));
    const body = mix(dusk, bright, height.mul(height).mul(0.5).add(lit.mul(0.5)).mul(puff.mul(0.3).add(0.7)));
    const rainy = float(1.0).sub(u.rain.mul(0.4).mul(smoothstep(0.0, 0.06, under)));
    return { cover, light: body.mul(rainy).add(glow.mul(crown.mul(0.6))) };
}

/**
 * One rank of the far tablelands beyond the valley's rim, drawn on the dome (a skyline over the
 * bearing): mesas and buttes, flat-topped (the height is a noise stepped into benches, with a
 * riser over a slope of scree between), their tops a little uneven. They stand in so much air
 * that they are the sky's own colour a shade deeper, paler toward their feet (the valley's haze)
 * and toward the suns (the glare), with faint beds across their cliffs and a thread of the suns'
 * light along their tops. `pale` how far a rank has faded into the air (a farther rank is paler).
 * Returns how much of the sight line it covers and its light.
 */
function mesaRank(u, noise, dir, az, behind, glow, scale, row, lift, pale) {
    const M = SKY_LOOK.mesas;
    const along = az.mul(scale).toVar();
    const broad = texture(noise, vec2(along.mul(0.17), row)).level(0.0).r;
    const fine = texture(noise, vec2(along.mul(1.1), row + 0.41)).level(0.0).g.toVar();
    // (The baked noise keeps to the middle of its range: stretched to the whole of it first.)
    const lump = broad.mul(0.72).add(fine.mul(0.28)).sub(0.32).div(0.36)
        .clamp(0.0, 1.0)
        .mul(M.benches)
        .toVar();
    // (A riser takes the last third of a bench: a cliff over a slope of scree, not a notch.)
    const bench = floor(lump).add(smoothstep(0.66, 1.0, fract(lump))).div(M.benches);
    const rough = texture(noise, vec2(along.mul(5.3), row + 0.77)).level(0.0).b;
    const top = bench.sub(M.floor).mul(M.rise * lift).add(fine.sub(0.5).mul(0.006)).add(rough.sub(0.5).mul(0.0035))
        .toVar();
    const under = top.sub(dir.y).toVar();
    const cover = smoothstep(0.0, 0.0016, under);
    // Paler toward its foot, and faint beds across its cliffs (lines a few pixels apart, gone
    // where they would be finer than that).
    const foot = float(1.0).sub(smoothstep(0.0, 0.05, dir.y)).mul(0.7);
    const bedAt = dir.y.mul(M.beds).add(fine.mul(2.0));
    const bed = smoothstep(0.7, 1.0, fract(bedAt)).mul(float(1.0).sub(smoothstep(0.25, 0.6, fwidth(bedAt)))).mul(M.bed);
    const body = mix(behind.mul(0.62), behind, max(float(pale), foot)).mul(float(1.0).sub(bed));
    const rim = exp(under.max(0.0).div(-M.rim));
    return { cover, light: body.add(glow.mul(rim.mul(0.12))) };
}

/**
 * The sky's light along a unit direction (the land and the haze read the same function, without
 * the discs and the cloud). The dome away from the suns has colours of its own: a deep
 * cobalt-violet overhead over a rose-mauve horizon, so no part of the sky is ever grey. With
 * `clouds` (the baked noise) it is the dome as the eye sees it: the high ice cloud, the banks along
 * the rim, the braid's own light, the moon and the stars.
 */
export function skyColor(u, dir, { discs = true, clouds = null, ribbons = false } = {}) {
    const L = SKY_LOOK;
    const up = max(dir.y, 0.0).toVar();
    const base = mix(u.horizon, u.zenith, float(1.0).sub(exp(up.mul(-L.climb)))).toVar();
    const extras = Boolean(clouds);
    const plane = extras ? lensPlane(u, dir).toVar() : null;
    const one = (k, S, C, G, share, cosR, at) => {
        const cosDisc = discs ? cosR : float(2.0);
        return sunInSky(u, dir, S, C, G, share, cosDisc, up, extras, at, plane, clouds, k);
    };
    const sky = base
        .add(one(0, u.sun0, u.col0, u.glow0, u.glowShare.x, u.discCos.x, u.disc0))
        .add(one(1, u.sun1, u.col1, u.glow1, u.glowShare.y, u.discCos.y, u.disc1))
        .add(one(2, u.sun2, u.col2, u.glow2, u.glowShare.z, u.discCos.z, u.disc2))
        .toVar();
    if (ribbons) sky.addAssign(braidRibbons(u, dir));
    if (!clouds) return sky;
    sky.addAssign(braidLight(u, dir, clouds));
    // Each sun's forward light in thin cloud: a tight lobe in its own colour (a street that stands
    // before a sun is that sun's colour), on a wide one.
    const lightOf = (S, C, G, tight, wide) => {
        const mu = clamp(dot(dir, S), -1.0, 1.0);
        return C.mul(0.8).add(G.mul(0.2)).mul(lobe(mu, 0.8).mul(tight).add(lobe(mu, 0.3).mul(wide)).add(0.02));
    };
    const sunward = (tight, wide) => lightOf(u.sun0, u.col0, u.glow0, tight, wide)
        .add(lightOf(u.sun1, u.col1, u.glow1, tight, wide))
        .add(lightOf(u.sun2, u.col2, u.glow2, tight, wide));
    const fill = u.zenith.mul(CLOUD_FILL.zenith).add(u.horizon.mul(CLOUD_FILL.horizon)).toVar();

    // ── The stars (dusk), behind every cloud ──
    const az = atan(dir.x, dir.z.negate()).toVar();
    const grid = vec2(az, dir.y).mul(L.stars.cells).toVar();
    // (Cells shifted positive: a hash of a negative cell repeats its neighbour's.)
    const cell = floor(grid).add(vec2(512.0, 64.0)).toVar();
    const inCell = fract(grid);
    const seed = sbHash22(cell).toVar();
    const rank = sbHash21(cell.add(vec2(19.0, 47.0))).toVar();
    const grain = fwidth(grid.y).max(1e-4);
    const radius = max(grain.mul(1.15), 0.035);
    const starAt = length(inCell.sub(seed.mul(0.56).add(0.22)));
    const twinkle = sin(u.time.mul(seed.x.mul(3.0).add(1.5)).add(seed.y.mul(40.0))).mul(0.22).add(0.78);
    const star = smoothstep(radius, radius.mul(0.35), starAt).mul(step(rank, L.stars.share))
        .mul(pow(float(1.0).sub(rank.div(L.stars.share)).max(0.0), 3.0).add(0.06))
        .mul(twinkle);
    // Far suns of the three kinds: a star is faintly one of the suns' colours.
    const cool = mix(vec3(0.75, 1.0, 0.86), vec3(0.74, 0.82, 1.0), step(0.66, seed.x));
    const hue = mix(vec3(1.0, 0.78, 0.7), cool, step(0.33, seed.x));
    sky.addAssign(hue.mul(star.mul(u.stars).mul(L.stars.gain).mul(smoothstep(0.004, 0.07, dir.y))));

    // ── The high ice cloud: streets fanning out from under the suns ──
    const C = L.cirrus;
    const reach = float(C.height).sub(u.eye.y).div(max(dir.y, 0.012)).toVar();
    const X = u.eye.xz.add(dir.xz.mul(reach)).toVar();
    const ice = cirrusDensity(u, clouds, X).mul(exp(reach.div(-C.fade))).mul(smoothstep(0.0, 0.035, dir.y)).toVar();
    // Thin ice sends each sun's light on toward the eye; away from the suns it is a pale streak of
    // the dome's own colour (mixed toward it, never added: added, it turned the rose to white).
    const iceLit = sunward(0.3, 0.05).mul(C.lit).add(fill.mul(C.fill));
    sky.assign(mix(sky, iceLit.add(sky.mul(0.55)), ice.mul(0.72)));

    // ── The banks along the rim: two ranks, the farther one first ──
    const flat = normalize(vec3(dir.x, 0.0, dir.z).add(vec3(1e-5, 0.0, 0.0))).toVar();
    const flatCentre = normalize(vec3(u.centre.x, 0.0, u.centre.z).add(vec3(1e-5, 0.0, 0.0))).toVar();
    const keep = float(1.0).sub(smoothstep(0.86, 0.985, dot(flat, flatCentre)).mul(L.banks.keepOff)).toVar();
    const glow = sunward(0.55, 0.1).toVar();
    // Which way along the rim the suns stand from here (the puffs' lit flank).
    const sunSide = flat.x.mul(flatCentre.z).sub(flat.z.mul(flatCentre.x));
    const flank = select(sunSide.greaterThan(0.0), float(1.0), float(-1.0)).toVar();
    // The sky as it is behind a bank or a mesa, without the discs: the dome's gradient and each
    // sun's glow low along its bearing (its afterglow, once it has set). (Coloured by the dome's
    // rest colours alone they stood magenta against a jade afterglow.)
    const low = exp(up.mul(-5.5));
    const glowOf = (S, G, share) => {
        const toward = dot(flat, normalize(vec3(S.x, 0.0, S.z).add(vec3(1e-5, 0.0, 0.0)))).mul(0.5).add(0.5);
        const t2 = toward.mul(toward);
        return G.mul(t2.mul(t2).mul(low).mul(share).mul(0.085)
            .add(0.014));
    };
    const behind = base.add(glowOf(u.sun0, u.glow0, u.glowShare.x)).add(glowOf(u.sun1, u.glow1, u.glowShare.y))
        .add(glowOf(u.sun2, u.glow2, u.glowShare.z))
        .toVar();
    const far = bankRank(u, clouds, dir, az, keep, glow, behind, flank, 1.0, 0.21, 1.0, 0.74);
    // (A farther rank stands in more air: it pales toward the dome.)
    sky.assign(mix(sky, mix(far.light, behind, 0.3), far.cover.mul(0.94)));
    const near = bankRank(u, clouds, dir, az.add(1.7), keep, glow, behind, flank, 0.62, 0.67, 0.56, 0.56);
    sky.assign(mix(sky, near.light, near.cover.mul(0.96)));

    // ── The far tablelands beyond the rim: two ranks, the farther paler ──
    const farMesa = mesaRank(u, clouds, dir, az, behind, glow, 1.0, 0.13, 1.0, 0.86);
    sky.assign(mix(sky, farMesa.light, farMesa.cover));
    const nearMesa = mesaRank(u, clouds, dir, az.add(2.3), behind, glow, 0.6, 0.83, 0.62, 0.7);
    sky.assign(mix(sky, nearMesa.light, nearMesa.cover));

    // ── The moon: a dark disc (round in the lens, as the suns are) before whatever it crosses,
    // a thread of light on the suns' side ──
    const inMoon = plane.sub(u.moonAt.xy).div(max(u.moonAt.z, 1e-5)).toVar();
    const moonRad = length(inMoon).toVar();
    const moonMask = smoothstep(1.03, 0.97, moonRad).mul(u.moonSeen).mul(step(0.0, dot(dir, u.lensAhead)));
    const toSuns = lensPlane(u, u.centre).sub(u.moonAt.xy);
    const lit = dot(inMoon.div(max(moonRad, 1e-4)), toSuns.div(max(length(toSuns), 1e-5))).max(0.0);
    const thread = smoothstep(0.8, 1.0, moonRad).mul(lit.mul(lit));
    const moonLight = behind.mul(0.5).add(u.col0.add(u.col1).add(u.col2).mul(thread.mul(0.5)));
    return mix(sky, moonLight, moonMask);
}

/**
 * The dome as a lean tier's mirror reads it: its gradient, and for each sun a glow and a glint the
 * size of its disc (no corona, no horizon glow: a third of the dome's arithmetic).
 */
export function leanSky(u, dir) {
    const up = max(dir.y, 0.0);
    const base = mix(u.horizon, u.zenith, float(1.0).sub(exp(up.mul(-SKY_LOOK.climb))));
    const one = (S, C, G) => {
        const off = float(1.0).sub(clamp(dot(dir, S), -1.0, 1.0)).toVar();
        return G.mul(exp(off.mul(-14.0)).mul(0.05)).add(C.mul(exp(off.mul(-2600.0)).mul(2.2)));
    };
    return base.add(one(u.sun0, u.col0, u.glow0)).add(one(u.sun1, u.col1, u.glow1)).add(one(u.sun2, u.col2, u.glow2));
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
        start: int(0), end: u.solidCount, type: 'int', condition: '<', name: 'mst',
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

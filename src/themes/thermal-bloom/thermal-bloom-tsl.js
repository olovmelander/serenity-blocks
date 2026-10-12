/**
 * Thermal Bloom — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps and the WebGL2 leg):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function; laid-out helpers are pure (no captured uniforms or textures);
 *  - builders that read the uniform bag or a texture (tbViewRay, tbSky, tbAerial, …) are plain
 *    JavaScript inlined inside a material's Fn, never laid out;
 *  - no MaterialX noise, no 3D textures, no ShaderMaterial: noise is baked on the CPU into 2D
 *    DataTextures (thermal-bloom-bake.js) or hashed arithmetically;
 *  - nothing is lit by scene lights: every part writes its own light, scene-linear and unbounded
 *    (HDR); the post stack owns the tone map;
 *  - ONE uniform bag `u`: the world writes `.value`, materials only read. Exactly one uniform
 *    array (the event table), so a stage stays far under its uniform-buffer budget; every other
 *    value is a plain uniform.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
    acos,
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
    select,
    sin,
    smoothstep,
    sqrt,
    step,
    texture,
    uniform,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    COLORS,
    EVENT_ROWS,
    GHOSTS_MAX,
    IRIS_RADIUS,
    SEASONS,
    STEAM_LEAN,
    STEAM_SLOTS,
    hexToLinear,
} from './thermal-bloom-core.js';

export * from './thermal-bloom-core.js';

// ── Laid-out pure helpers ───────────────────────────────────────────────────────

/** vec2 → [0,1) */
export const tbHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'tb_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → [0,1) */
export const tbHash31 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.zyx.add(31.32)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'tb_hash31', type: 'float', inputs: [{ name: 'pIn', type: 'vec3' }] });

/** Rounded-box signed distance in pixels. rect = (x0, y0, x1, y1) in pixels (top-left origin). */
export const tbRoundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'tb_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/** Rec.709 luminance. */
export const tbLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const tbMax3 = (c) => max(c.x, max(c.y, c.z));

/**
 * The mineral filmic: a hue-preserving shoulder on the max channel (identity below k = 0.5), so
 * the mats keep their colour; tuned so lit steam (about 1.1 in the scene) lands near 0.86 and
 * never at a flat 1.0. Only the brightest glints (a peak of 6 and more) whiten.
 */
export const tbFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(tbMax3(c), 1e-5);
    const k = float(0.5);
    const room = float(0.5); // the shoulder rises from k toward 1
    const shoulder = k.add(room.mul(float(1.0).sub(exp(peak.sub(k).div(room).mul(-1.15)))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(6.0, 40.0, peak).mul(0.7));
}).setLayout({ name: 'tb_filmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

/**
 * The primary rainbow (§3.4), analytic: for the cosine of the angle between the view ray and the
 * antisolar direction (pass dot(V, sunDir), V toward the camera), the band's colour in xyz (red
 * outside at 42.4°, violet inside at 40.6°, seven stops, no supernumeraries) and in w the spray's
 * brightness factor (×1.15 inside the bow, ×0.85 outside, each blended over 0.6°).
 */
export const tbBow = /* @__PURE__ */ Fn(([cosA]) => {
    const deg = acos(clamp(cosA, -1.0, 1.0)).mul(180.0 / Math.PI);
    const x = clamp(deg.sub(40.6).div(1.8), 0.0, 1.0).mul(6.0);
    const band = smoothstep(40.2, 40.7, deg).mul(float(1.0).sub(smoothstep(42.3, 42.8, deg)));
    const stops = [
        vec3(0.32, 0.08, 0.55), vec3(0.1, 0.2, 0.85), vec3(0.05, 0.55, 0.65), vec3(0.1, 0.7, 0.18),
        vec3(0.85, 0.78, 0.08), vec3(0.95, 0.42, 0.04), vec3(0.8, 0.07, 0.04),
    ];
    let c = stops[0];
    for (let i = 1; i < stops.length; i++) c = mix(c, stops[i], clamp(x.sub(i - 1), 0.0, 1.0));
    const factor = mix(float(1.15), float(1.0), smoothstep(40.3, 40.9, deg))
        .mul(mix(float(1.0), float(0.85), smoothstep(42.1, 42.7, deg)));
    return vec4(c.mul(band), factor);
}).setLayout({ name: 'tb_bow', type: 'vec4', inputs: [{ name: 'cosA', type: 'float' }] });

/** Schlick's Fresnel, written as products (a pow of a hair below zero is NaN). */
export const tbSchlick = /* @__PURE__ */ Fn(([cosT, f0]) => {
    const x = float(1.0).sub(clamp(cosT, 0.0, 1.0));
    const x2 = x.mul(x);
    return f0.add(float(1.0).sub(f0).mul(x2.mul(x2).mul(x)));
}).setLayout({
    name: 'tb_schlick', type: 'float', inputs: [{ name: 'cosT', type: 'float' }, { name: 'f0', type: 'float' }],
});

/**
 * Henyey–Greenstein phase as a 0..1 mix weight: 1 looking straight at the sun. x·√x of
 * x = (1 − g)² / (1 + g² − 2g·c), on a clamped cosine (never a pow of a negative).
 */
export const tbHgMix = /* @__PURE__ */ Fn(([cIn, g]) => {
    const c = clamp(cIn, -1.0, 1.0);
    const one = float(1.0).sub(g);
    const x = one.mul(one).div(max(float(1.0).add(g.mul(g)).sub(g.mul(c).mul(2.0)), 1e-4));
    return x.mul(sqrt(x));
}).setLayout({
    name: 'tb_hgMix', type: 'float', inputs: [{ name: 'cIn', type: 'float' }, { name: 'g', type: 'float' }],
});

// ── The uniform bag ─────────────────────────────────────────────────────────────

const rows = (count) => Array.from({ length: count }, () => new THREE.Vector4(0, 0, 0, 0));
const lin = (hex) => {
    const c = hexToLinear(hex);
    return new THREE.Vector3(c[0], c[1], c[2]);
};

/**
 * Every uniform the scene's materials share, set for High Summer at rest. The world owns the
 * values; materials only read.
 */
export function createThermalBloomUniforms() {
    const season = SEASONS[0];
    const events = rows(EVENT_ROWS.total);
    const plumes = rows(STEAM_SLOTS * 2);
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Radians of view per pixel of the drawing buffer. */
        pixelAngle: uniform(0.0008),
        // The camera, for the full-screen backdrop (drawn without one).
        camPos: uniform(new THREE.Vector3(0, 44, 0)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 0.951, -0.309)),
        camFwd: uniform(new THREE.Vector3(0, -0.309, -0.951)),
        tanHalf: uniform(new THREE.Vector2(0.755, 0.4245)),
        /** Unit vector toward the sun (L), and the sun's colour (linear, scene-referred). */
        sunDir: uniform(new THREE.Vector3(-0.73, 0.53, 0.42)),
        sunColor: uniform(lin(COLORS.sun)),
        // The season's air (eased by the world across a level-up).
        zenith: uniform(lin(season.zenith)),
        haze: uniform(lin(season.haze)),
        pearl: uniform(lin(COLORS.hazePearl)),
        rim: uniform(lin(season.rim)),
        meadow: uniform(lin(season.meadow)),
        plateau: uniform(lin(COLORS.plateau)),
        snow: uniform(season.snow),
        frost: uniform(season.frost),
        /** Aerial perspective: optical depth per metre of the basin's air. */
        airDensity: uniform(0.00012),
        /** The season's streamers in the runoff channels (Bloom's rose) and how strongly they show. */
        streamer: uniform(new THREE.Vector3(0.7, 0.1, 0.3)),
        streamerAmount: uniform(0),
        /** The season's meltwater sheen on the apron (Thaw). */
        wetness: uniform(0),
        /** Four lines' apron flood (its start on the wrapped clock), the fumaroles' sympathy, the bow. */
        floodAt: uniform(-1e6),
        sympathyAt: uniform(-1e6),
        bow: uniform(0),
        /** Far columns the tier draws no sheets for, as analytic ghosts in the sky: count. */
        ghostCount: uniform(0, 'int'),
        /** The Chalice drained at a game over (0..1), and the Consort's mound wet (0..1). */
        drain: uniform(0),
        consortWet: uniform(0),
        /** The breath (0 warm/thin … 1 cold/thick) and the steam density it implies. */
        breath: uniform(0.5),
        steam: uniform(1),
        /** Wind: heading (unit xz) and speed (m/s). */
        windDir: uniform(new THREE.Vector2(1, 0)),
        windSpeed: uniform(2.5),
        /** The gust tearing through the Iris's steam: phase 0..1 across its crossing (−1: none), lane seed. */
        gust: uniform(new THREE.Vector2(-1, 0)),
        /**
         * The steam plumes, two rows each: (x, z, base, height), (r0, r1, density, kind); the
         * Iris's dome first. `steamCount` live slots.
         */
        tables: null,
        steamPlumes: null,
        steamCount: uniform(0, 'int'),
        /** The jewel pools on the far apron, one row each: (x, z, radius, kind). */
        jewels: null,
        /** The analytic steam veil's strength (the tier's: Low and Minimal lean on it). */
        veil: uniform(1),
        /** The card's union on screen (x0, y0, x1, y1; y down), or all −1: the steam thins over it. */
        cardRect: uniform(new THREE.Vector4(-1, -1, -1, -1)),
        /** The post's iris, inverted: event lights are raised by it so they read at any exposure. */
        iris: uniform(1),
        // Composition (world positions solved from the layout, metres).
        /** The Iris: centre (x, z) and the pool's radius. */
        irisCentre: uniform(new THREE.Vector2(-102, -196)),
        irisRadius: uniform(50),
        /** The direction the runoff fans out toward (unit xz: toward the camera, turned to the Iris's outer side). */
        downhill: uniform(new THREE.Vector2(-0.17, 0.98)),
        /** The combo's gauges: the eye's widening (a fraction) and the fingers' reach (× the rest reach). */
        heat: uniform(0),
        reach: uniform(1),
        /** The succession front: the season rows it sweeps from and to, and its radius (metres). */
        seasonFrom: uniform(0),
        seasonTo: uniform(0),
        frontRadius: uniform(1e6),
        /** The Stair's top (world xz): its local across axis runs from here at right angles to downhill. */
        stairTop: uniform(new THREE.Vector2(0, -250)),
        /** The Stair's downhill direction (unit xz, world). */
        stairDown: uniform(new THREE.Vector2(0.5, 0.86)),
        /** The Chalice's vent (x, y, z). */
        chalice: uniform(new THREE.Vector3(147, 6, -255)),
        /** The live events (blocks at EVENT_ROWS); live rows compacted at the front of each block. */
        events: uniformArray(events, 'vec4'),
        bloomCount: uniform(0, 'int'),
        fillCount: uniform(0, 'int'),
        jetCount: uniform(0, 'int'),
        eruptionCount: uniform(0, 'int'),
        boilCount: uniform(0, 'int'),
        devilCount: uniform(0, 'int'),
        rosetteCount: uniform(0, 'int'),
        plumeCount: uniform(0, 'int'),
    };
    const jewels = rows(3);
    // The ghosts: (azimuth, base elevation, angular half-width, top elevation), radians.
    const ghosts = Array.from({ length: GHOSTS_MAX }, () => new THREE.Vector4(0, 0, 0, 0));
    u.ghosts = uniformArray(ghosts, 'vec4');
    u.tables = {
        events, plumes, jewels, ghosts,
    };
    u.steamPlumes = uniformArray(plumes, 'vec4');
    u.jewels = uniformArray(jewels, 'vec4');
    return u;
}

// ── Inline builders (they read the bag) ─────────────────────────────────────────

/** The view ray through a UV of the frame (y down), from the camera uniforms. */
export const tbViewRay = (u, st) => {
    const nx = st.x.mul(2.0).sub(1.0);
    const ny = float(1.0).sub(st.y.mul(2.0));
    return u.camFwd.add(u.camRight.mul(nx.mul(u.tanHalf.x))).add(u.camUp.mul(ny.mul(u.tanHalf.y))).normalize();
};

/**
 * The sky along a direction: a high, clean cerulean that pales through the season's haze to a
 * warm pearl at the horizon; a touch brighter toward the sun (which is behind the camera, never
 * in frame), and the brighter band of a clear sky low on the antisolar side kept faint.
 */
export function tbSky(u, dir) {
    const up = clamp(dir.y, 0.0, 1.0);
    // The haze lives in the last few degrees above the rim; above it, a clean cerulean that
    // deepens slowly toward the zenith.
    const band = smoothstep(0.0, 0.075, up);
    const high = smoothstep(0.075, 0.6, up);
    const base = mix(mix(u.haze, u.zenith.mul(1.15), band), u.zenith.mul(0.8), high);
    const sunward = dot(dir, u.sunDir);
    const glow = tbHgMix(sunward, float(0.62)).mul(0.25);
    return base.add(u.sunColor.mul(glow));
}

/** The basin air's scale height (metres): the haze lies in the floor's cold air. */
const AIR_HEIGHT = 160;

/**
 * Aerial perspective: a colour seen through `dist` metres of the basin's air along `dir`,
 * scattered toward the warm pearl (lit) haze, never toward blue air. Bounded exponent.
 */
export function tbAerial(u, col, dist, dir) {
    // The haze thins with height (a scale height of AIR_HEIGHT metres): a ray that drops steeply
    // from a high camera crosses less of it than one that skims the floor. The optical depth is
    // the distance times the mean density along the drop, (1 − e^(−x)) / x of x = drop / height.
    const drop = max(dist.mul(dir.y.negate()), 0.0).div(AIR_HEIGHT);
    const thin = float(1.0).sub(exp(drop.negate())).div(max(drop, 1e-3));
    const tau = min(max(dist, 0.0).mul(u.airDensity).mul(min(thin, 1.0)), 12.0);
    const T = exp(tau.negate());
    const sunward = dot(dir, u.sunDir);
    // Lit haze: mostly the season's cool horizon haze, warmed a little by the pearl.
    const inscatter = mix(u.pearl, u.haze, 0.65).add(u.sunColor.mul(tbHgMix(sunward, float(0.5)).mul(0.08)));
    return col.mul(T).add(inscatter.mul(float(1.0).sub(T)));
}

/**
 * The warm bounce off the sinter (the favourites' hemisphere ambient): faces that look down or
 * sideways see the sunlit cream ground, so the risers, the cone's flanks and the pines' shade
 * sides are lifted warm, never a flat grey. `N` the world normal.
 */
export function tbBounce(u, N) {
    const down = clamp(float(1.0).sub(N.y), 0.0, 1.0).mul(0.5);
    const sunOnGround = max(u.sunDir.y, 0.0);
    return vec3(0.72, 0.66, 0.55).mul(u.sunColor).mul(sunOnGround.mul(down).mul(0.32));
}

/**
 * Sun glints on wet facets (the favourites' glitter, turned for a sun behind the shoulder): each
 * `cell`-metre cell of a wet surface holds one small facet tilted at random about `N` (by up to
 * `rough`), re-dealt a few times a second as the water film moves; where a facet's mirror sends
 * the sun into the eye, a point flashes far above the bloom's knee and the bloom haloes it. It
 * fades out where a cell is only a few pixels, so it never aliases into sparkle noise.
 */
export function tbGlint(u, P, N, V, wet, cell, rough) {
    const g = P.xz.div(cell);
    const c = floor(g);
    const clock = u.time.mul(1.6).add(tbHash21(c.add(0.5)).mul(9.0));
    const tick = floor(clock);
    // Each deal fades in and out (a facet tilting through the sun's mirror angle), never a pop.
    const pulse = sin(fract(clock).mul(Math.PI));
    const h1 = tbHash21(c.add(vec2(tick.mul(0.37), 1.7)));
    const h2 = tbHash21(c.add(vec2(5.3, tick.mul(0.61))));
    const h3 = tbHash21(c.add(vec2(tick.mul(0.13), 9.1)));
    const Nf = normalize(N.add(vec3(h1.sub(0.5), 0.0, h2.sub(0.5)).mul(rough * 2.0)));
    const H = normalize(u.sunDir.add(V));
    // cos^256: a lobe about 4° wide, by repeated squaring (no pow of a value that may be 0).
    const x = clamp(dot(Nf, H), 0.0, 1.0);
    let lobe = x;
    for (let k = 0; k < 8; k++) lobe = lobe.mul(lobe);
    const spot = length(fract(g).sub(vec2(h3, h1).mul(0.5).add(0.25)));
    const px = max(fwidth(g.x), 1e-4);
    const point = float(1.0).sub(smoothstep(0.06, px.add(0.14), spot));
    const fade = float(1.0).sub(smoothstep(0.2, 0.5, px));
    const strength = lobe.mul(point).mul(fade).mul(wet).mul(pulse.mul(pulse));
    return u.sunColor.mul(strength.mul(7.0));
}

/** The far apron's mean albedo (linear): pale, dry sinter between its bright flats and damp grey. */
export const TB_APRON = [0.6, 0.58, 0.53];

/**
 * The far apron's colour along `dir` at `dist` metres, lit as the basin lights flat ground: the
 * basin fades into it toward its rim, and the backdrop paints it where the basin's mesh ends, so
 * the two meet without a seam.
 */
export function tbFarApron(u, dist, dir) {
    const flat = clamp(u.sunDir.y.add(0.1).div(1.1), 0.0, 1.0);
    const light = u.sunColor.mul(flat.mul(1.45)).add(mix(u.haze, u.zenith, 0.6).mul(0.44));
    const snowy = mix(vec3(...TB_APRON), vec3(0.6, 0.63, 0.68), u.snow);
    return tbAerial(u, snowy.mul(light), dist, dir);
}

/**
 * The plumes' shade at a point (the sum of every plume's shadow streak there; 0 in full sun):
 * each plume's axis, from its foot to 85% of its height, cast along the sun onto the plane
 * through `P` — a long soft streak as wide as the plume at that height, Beer over its thickness
 * (a thin thread casts a faint one; the dome, thin to look through, shades with its whole body).
 * Feed exp(−k · shade · steam) to the sun term; `vent` marks the far columns' wet feet. Shared by
 * the ground and the mist's lanes.
 */
export function tbPlumeShade(u, P) {
    const shade = float(0.0).toVar();
    const vent = float(0.0).toVar();
    const toCam = u.camPos.sub(P);
    const steep = smoothstep(0.3, 0.5, toCam.y.div(max(length(toCam), 1e-3)));
    Loop({
        start: int(0), end: u.steamCount, type: 'int', condition: '<', name: 'pl',
    }, ({ pl }) => {
        const A = u.steamPlumes.element(pl.mul(2));
        const B = u.steamPlumes.element(pl.mul(2).add(1));
        const run = u.sunDir.xz.div(max(u.sunDir.y, 0.15));
        const top = A.w.mul(0.85);
        const lean = u.windDir.mul(u.windSpeed.mul(STEAM_LEAN)).mul(top.div(400.0).add(1.0));
        const a0 = A.xy.sub(run.mul(A.z.sub(P.y)));
        const a1 = A.xy.add(lean.mul(top)).sub(run.mul(A.z.add(top).sub(P.y)));
        const seg = a1.sub(a0);
        const f = clamp(dot(P.xz.sub(a0), seg).div(max(dot(seg, seg), 1e-3)), 0.0, 1.0);
        const e = length(P.xz.sub(a0.add(seg.mul(f)))).div(max(mix(B.x, B.y, sqrt(f)), 1.0));
        const thick = min(B.x.div(25.0), 1.0);
        // (the dome thins to a veil where it is looked down on steeply, so its shade thins with it:
        // the upright phone sees neither a dome nor a shadow without one)
        const isDomeRow = step(abs(B.w.sub(1.0)), 0.5);
        const shadowK = max(B.z, isDomeRow.mul(1.4)).mul(float(1.0).sub(isDomeRow.mul(steep).mul(0.9)));
        shade.addAssign(exp(e.mul(e).mul(-1.4)).mul(shadowK).mul(thick).mul(float(1.0).sub(f.mul(0.5))));
        // A far column rises from a wet, dark vent on the apron (its foot reads against the pale ground).
        const vd = length(P.xz.sub(A.xy)).div(max(B.x.mul(0.75), 1.0));
        vent.addAssign(exp(vd.mul(vd).negate()).mul(step(B.w, 0.5)).mul(step(A.z, 2.0)));
    });
    return { shade, vent };
}

/**
 * The analytic steam veil (§3.6.1 item 7): a low, warm-white haze over the basin whose density
 * follows the breath and gathers round the Iris, so the frame reads as "steam everywhere" even
 * where few sheets stand (it carries most of that on Low and Minimal). `P` world position.
 */
export function tbSteamVeil(u, col, P) {
    const d = length(P.xz.sub(u.irisCentre)).div(IRIS_RADIUS * 2.6);
    const low = exp(P.y.div(-25.0));
    // Round the pool, not over its water: the eye's cobalt stays the frame's darkest shape (§3.3).
    const ring = smoothstep(0.25, 0.55, d);
    const veil = u.steam.mul(u.veil).mul(float(0.012).add(exp(d.mul(d).negate()).mul(ring).mul(0.08))).mul(low);
    const warm = mix(u.pearl, vec3(0.92, 0.9, 0.86), 0.5).mul(u.sunColor).mul(0.85);
    return mix(col, warm, clamp(veil, 0.0, 0.5));
}

/**
 * How a bloom row packs its shape into its code (world.writeBlooms writes it, tbBlooms reads it):
 * code = heading·100000 + side·10000 + span·100 + length, the heading the flow's direction in
 * 128ths of a turn (0 along +z, a quarter along +x), span and length whole metres (each < 100).
 */
export const BLOOM_CODE = Object.freeze({
    headings: 128, heading: 100000, side: 10000, span: 100,
});

const TB_TAU = Math.PI * 2;

/**
 * The locks' blooms on one side (§3.7): scour, then streamers in the piece's colour, then the
 * bleach. Loops over the live bloom rows (two each: (x, z, start, life) and (r, g, b, code); the
 * code is BLOOM_CODE's) and returns, for the ground point `P`, how much is scoured to bare wet
 * cream, the streamers' colour and cover, and the moving wet front. `side` 0 is the Iris's ground,
 * 1 the Stair. The world anchors each fan where the surge leaves its channel (the Stair: the
 * brimming lip) and heads it downstream, away from the card; here it is a fan of fine streamers
 * radiating from that foot, its sides frayed and its far end lobed, outlined by a thin darker
 * line of its own hue, on an opaque strip of scoured cream. `channel` (optional, 0..1): the
 * ground's own runoff channels, which the surge fills first.
 */
export function tbBlooms(u, P, side, tex, { channel = null } = {}) {
    const tint = vec3(0.0).toVar();
    const cover = float(0.0).toVar();
    const scour = float(0.0).toVar();
    const front = float(0.0).toVar();
    Loop({
        start: int(0), end: u.bloomCount, type: 'int', condition: '<', name: 'bl',
    }, ({ bl }) => {
        const A = u.events.element(bl.mul(2).add(EVENT_ROWS.blooms));
        const B = u.events.element(bl.mul(2).add(EVENT_ROWS.blooms + 1));
        const code = B.w;
        const headQ = floor(code.div(BLOOM_CODE.heading));
        const rest = code.sub(headQ.mul(BLOOM_CODE.heading));
        const s = floor(rest.div(BLOOM_CODE.side));
        const rem = rest.sub(s.mul(BLOOM_CODE.side));
        const spanQ = floor(rem.div(BLOOM_CODE.span));
        const span = max(spanQ, 1.0);
        const len = max(rem.sub(spanQ.mul(BLOOM_CODE.span)), 1.0);
        const onSide = step(abs(s.sub(side)), 0.5);
        const age = u.time.sub(A.z);
        const life = max(A.w, 1.0);
        const live = step(0.0, age).mul(step(age, life)).mul(onSide);
        const heading = headQ.mul(TB_TAU / BLOOM_CODE.headings);
        const dir = vec2(sin(heading), cos(heading));
        const perp = vec2(dir.y.negate(), dir.x);
        const rel = P.xz.sub(A.xy);
        const al = dot(rel, dir);
        const ac = dot(rel, perp);
        // Each slot reads its own stretch of the noise atlas, so no two fans are alike.
        const seed = tbHash21(floor(A.xy).add(vec2(17.0, 3.0)));
        const ofs = vec2(seed.mul(37.0), fract(seed.mul(91.0)).mul(23.0));
        const f = clamp(al.div(len), 0.0, 1.0);
        // The fan: narrow where the surge leaves its channel, widening downstream; its sides swing
        // slowly and fray finely, so the edge is never a straight cut.
        const swing = texture(tex.noise, vec2(al.div(len).mul(0.35), seed).add(ofs)).x.sub(0.5);
        const fray = texture(tex.noise, vec2(al.div(1.3), ac.div(1.1)).div(16.0).add(ofs)).z.sub(0.5);
        const halfEnd = span.mul(0.5);
        const half = halfEnd.mul(f.mul(0.6).add(0.4)).mul(swing.mul(0.8).add(1.0))
            .add(fray.mul(halfEnd).mul(0.34));
        // Across the fan as an angle about a point upstream of its foot: the streamers radiate.
        const fanA = ac.div(max(al.add(len.mul(0.4)), len.mul(0.2))).mul(len.mul(1.4)).div(halfEnd);
        // The lobed far end: each streamer runs its own way down.
        // The far end frays into the streamers' own tips: each runs its own length.
        const lobe = texture(tex.noise, vec2(fanA.mul(0.22), seed.mul(0.7)).add(ofs)).y;
        const tips = texture(tex.noise, vec2(fanA.mul(1.3), seed.mul(1.9)).add(ofs.mul(0.4))).z;
        const grow = smoothstep(0.2, 1.7, age);
        const reach = len.mul(grow).mul(lobe.mul(0.4).add(tips.mul(0.35)).add(0.6));
        const scourReach = len.mul(smoothstep(0.0, 0.3, age)).mul(lobe.mul(0.4).add(0.72)).add(span.mul(0.06));
        // Recolonised from L/2 to L in patches: the mat takes the fan back piece by piece.
        const heal = smoothstep(life.mul(0.5), life, age);
        const patchN = texture(tex.noise, vec2(al.div(2.2), ac.div(2.2)).div(8.0).add(ofs.mul(0.7))).y;
        const keep = smoothstep(heal.sub(0.12), heal.add(0.12), patchN.mul(0.9).add(0.05))
            .mul(float(1.0).sub(smoothstep(life.mul(0.92), life, age)));
        // The scour: a strip barely wider than the fan, scrubbed to bare wet cream first; its edge
        // frays into the mats over a few pixels instead of a cut line.
        const sideS = half.mul(1.06).add(span.mul(0.02)).sub(abs(ac));
        const dScour = min(min(sideS, scourReach.sub(al)), al.add(span.mul(0.1)));
        const pxS = max(fwidth(dScour), 1e-4);
        const feather = texture(tex.noise, vec2(al.div(0.7), ac.div(0.7)).div(16.0).add(ofs.mul(1.3))).z.sub(0.5);
        const scoured = smoothstep(-1.0, 3.0, dScour.div(pxS).add(feather.mul(5.0)));
        scour.assign(max(scour, scoured.mul(live).mul(keep)));
        // The bloom's outline (positive inside), in pixels: an anti-aliased edge and a thin rim line.
        const dBloom = min(min(half.sub(abs(ac)), reach.sub(al)), al.add(span.mul(0.1)));
        const pxD = dBloom.div(max(fwidth(dBloom), 1e-4));
        const inside = clamp(pxD.add(0.5), 0.0, 1.0).mul(live).mul(step(0.02, grow));
        const rimLine = inside.mul(float(1.0).sub(smoothstep(1.2, 2.6, pxD)));
        // Streamers: thin threads where squeezed noise crosses its middle (long strands along the
        // flow), braided by a finer set; the surge fills the ground's own channels first.
        const n1 = texture(tex.noise, vec2(fanA.mul(0.55), f.mul(0.12)).add(ofs.mul(0.5))).y;
        const n2 = texture(tex.noise, vec2(fanA.mul(1.15), f.mul(0.22)).add(ofs.mul(0.3)).add(0.5)).z;
        const ridge1 = float(1.0).sub(abs(n1.mul(2.0).sub(1.0)));
        const ridge2 = float(1.0).sub(abs(n2.mul(2.0).sub(1.0)));
        let threads = max(smoothstep(0.7, 0.9, ridge1), smoothstep(0.76, 0.94, ridge2).mul(0.8));
        if (channel) threads = max(threads, channel.mul(0.9));
        // Saturated for 0.13 L, pale to cream by 0.5 L, recolonised by L (the whole curve in L).
        const sat = float(1.0).sub(smoothstep(life.mul(0.13), life.mul(0.5), age));
        const paled = mix(vec3(0.84, 0.8, 0.68), B.xyz, sat);
        const rimCol = mix(paled, B.xyz.mul(0.42), sat.mul(0.85).add(0.1));
        const m = max(inside.mul(threads.mul(0.84).add(0.13)), rimLine.mul(sat.mul(0.55).add(0.35))).mul(keep)
            .mul(smoothstep(0.15, 0.4, age));
        const col = mix(paled, rimCol, clamp(rimLine.mul(1.3), 0.0, 1.0));
        tint.assign(mix(tint, col, step(cover, m)));
        cover.assign(max(cover, m));
        // The wet leading edges: the surge's while it scours, the streamers' while they grow.
        const lat = clamp(sideS.div(pxS).add(0.5), 0.0, 1.0).mul(live);
        const surge = scourReach.sub(al).div(span.mul(0.16).add(0.5));
        const lead = reach.sub(al).div(span.mul(0.1).add(0.4));
        const fronts = max(
            exp(surge.mul(surge).negate()).mul(float(1.0).sub(smoothstep(0.3, 0.8, age))),
            exp(lead.mul(lead).negate()).mul(smoothstep(0.2, 0.4, age)).mul(float(1.0).sub(smoothstep(1.7, 2.6, age))),
        );
        front.assign(max(front, fronts.mul(lat)));
    });
    return {
        tint, cover, scour, front,
    };
}

/** The stone record: 16 rows (10 Stair tiers, then 6 microterrace zones beside the Iris). */
export const RECORD_ROWS = 16;
export const RECORD_RING0 = 10;

/**
 * The Seal's fills on one side (§1.5, §3.8). Each live fill row (x, z, start, code; code =
 * side·100 + index) runs one timeline: the new lip draws itself outward from the aim (0–0.4 s,
 * frost sparkling at its growing ends), the pool behind it fills and lights from within
 * (0.4–1.2 s), a sheet spills over the lip down the face below it (0.9–2.2 s), and the row's
 * stripe fixes into that face (0.4–1.2 s); everything settles by 6 s. `at(index, A, e)` turns
 * that timeline `e` into this fragment's masks for one row (the side's own geometry) and returns
 * { lip, pool, sheet, unfixed, glint, shade } (each 0..1; `shade` the crisp shadow line under a
 * new lip); tbFills keeps the strongest of each.
 */
export function tbFills(u, side, at) {
    const lip = float(0.0).toVar();
    const pool = float(0.0).toVar();
    const sheet = float(0.0).toVar();
    const unfixed = float(0.0).toVar();
    const glint = float(0.0).toVar();
    const shade = float(0.0).toVar();
    Loop({
        start: int(0), end: u.fillCount, type: 'int', condition: '<', name: 'fl',
    }, ({ fl }) => {
        const A = u.events.element(fl.add(EVENT_ROWS.fills));
        const s = floor(A.w.div(100.0));
        const index = A.w.sub(s.mul(100.0));
        const onSide = step(abs(s.sub(side)), 0.5);
        const age = u.time.sub(A.z);
        const live = step(0.0, age).mul(step(age, 6.0)).mul(onSide);
        const settle = float(1.0).sub(smoothstep(3.0, 6.0, age));
        const e = {
            age,
            /** How far the lip has drawn (0..1 of its reach), and the sparkle at its growing ends. */
            draw: smoothstep(0.0, 0.4, age),
            tip: float(1.0).sub(smoothstep(0.35, 0.9, age)),
            /** The new lip: crisp white while it sets, settling into the rim's own white. */
            lipOn: settle.mul(float(1.0).sub(smoothstep(0.8, 3.0, age)).mul(0.35).add(0.65)),
            /** The pool behind it: rising and lit from within, then easing back. */
            fill: smoothstep(0.4, 1.2, age).mul(float(1.0).sub(smoothstep(2.8, 6.0, age))),
            /** The sheet over the lip: how far down the face it has slid (0..1), and how much shows. */
            slide: smoothstep(0.9, 2.0, age),
            sheetOn: smoothstep(0.85, 1.0, age).mul(float(1.0).sub(smoothstep(2.2, 3.6, age))),
            /** The stripe below: 0 → 1 as it fixes into the stone. */
            fixed: smoothstep(0.4, 1.2, age),
        };
        const r = at(index, A, e);
        lip.assign(max(lip, r.lip.mul(live)));
        if (r.pool) pool.assign(max(pool, r.pool.mul(live)));
        if (r.sheet) sheet.assign(max(sheet, r.sheet.mul(live)));
        if (r.unfixed) unfixed.assign(max(unfixed, r.unfixed.mul(live)));
        if (r.glint) glint.assign(max(glint, r.glint.mul(live)));
        if (r.shade) shade.assign(max(shade, r.shade.mul(live)));
    });
    return {
        lip, pool, sheet, unfixed, glint, shade,
    };
}

// ── Materials, geometry and textures ────────────────────────────────────────────

/**
 * A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes.
 * Nothing here writes depth; `depthTest` lets the ground hide what is behind it.
 */
export function tbFxMaterial(name, { depthTest = true, side = THREE.DoubleSide } = {}) {
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
export function tbPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
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
 * The same typed array may back two textures (a layout's nearest and linear views).
 */
export function createThermalBloomTexture(data, width, height, {
    name = 'thermal-bloom-bake', filter = 'linear', wrap = 'repeat', channels = 4, mipmaps = null,
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

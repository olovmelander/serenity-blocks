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
    If,
    abs,
    cameraPosition,
    clamp,
    cos,
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
    log2,
    max,
    min,
    mix,
    mod,
    normalize,
    reflect,
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
    AGE_PHASE_STOPS,
    ATLAS_CONSISTENT,
    ATLAS_ISLANDS,
    ATLAS_RIBBONS,
    BARK_ACCENT,
    BARK_ALBEDO,
    BARK_CHROMA,
    BARK_FRESH_DIM,
    BARK_TEAR,
    BARK_TILE,
    CANOPY_CROWNS,
    CANOPY_LACE,
    CANOPY_Y,
    EVENT_ROWS,
    GROUP_CYCLE,
    ISLAND_LIFT,
    LATTICE_SLICE,
    MATRIX_AGE,
    PATCH_BUILD,
    PATCH_EDGE_RANGE,
    PATCH_LIFE,
    PATCH_REVEAL,
    PALETTE_ROWS,
    RIBBON_PHASE_STEP,
    TIDE_LIGHT,
    TRUNK_FLUTE,
    PIECE_AGE,
    ZONES,
    ZONE_COLOR_KEYS,
    barkAlbedo,
    buildMips,
    climbHeight,
    hexToLinear,
    mistGrainAt,
    rampAt,
    sunDirection,
    tideAt,
} from './rainbark-core.js';

export * from './rainbark-core.js';

const DEG_TSL = Math.PI / 180;

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

/**
 * The grove's age bias on a cyclic age (§3.4; TSL twin of warpAge): b ≥ 0 pushes ages old,
 * b < 0 young. Powers written as exp/log of clamped bases, so no exponent leaves [−20, 0].
 */
export const rbWarpAge = /* @__PURE__ */ Fn(([aIn, b]) => {
    const a = clamp(aIn, 0.0, 1.0);
    const older = float(1.0).sub(exp(log(max(float(1.0).sub(a), 1e-4)).mul(b.add(1.0))));
    const younger = exp(log(max(a, 1e-4)).mul(float(1.0).sub(b)));
    return select(b.greaterThanEqual(0.0), older, younger);
}).setLayout({
    name: 'rb_warpAge', type: 'float', inputs: [{ name: 'aIn', type: 'float' }, { name: 'b', type: 'float' }],
});

/** A warped life phase → its age on the ramp (TSL twin of ageOfPhase: AGE_PHASE_STOPS). */
export const rbAgeOfPhase = /* @__PURE__ */ Fn(([w]) => {
    let age = float(0.0);
    for (let i = 1; i < AGE_PHASE_STOPS.length; i++) {
        const [w0, a0] = AGE_PHASE_STOPS[i - 1];
        const [w1, a1] = AGE_PHASE_STOPS[i];
        age = age.add(clamp(w.sub(w0).div(w1 - w0), 0.0, 1.0).mul(a1 - a0));
    }
    return age;
}).setLayout({ name: 'rb_ageOfPhase', type: 'float', inputs: [{ name: 'w', type: 'float' }] });

/**
 * A bark patch now: (its age on the ramp, seconds since it last wrapped to fresh skin, seconds
 * until it next does). `cell` = (patch id, its tile around, its tile up), `salt` the trunk's seed,
 * `cycle` = (its group's life scale, the share of the group's patches that cycle).
 * The ribbons of one tile share a life ((240–600 s) × scale, hashed per tile) and stand at
 * evenly spread places in it (a permutation of ATLAS_RIBBONS strata, offset per tile), so every
 * tile shows the designed mix of ages at every moment, never two ribbons in one narrow band (a
 * lucky or unlucky draw of a hash would). Each runs on its group's clock, warped by its group's
 * age bias; a ribbon that does not cycle holds its place (and reports a wrap long ago and long
 * ahead).
 */
export const rbPatchAge = /* @__PURE__ */ Fn(([cell, salt, clock, bias, cycle]) => {
    const home = vec3(cell.y.mul(1.31).add(salt.mul(0.731)), cell.z.mul(0.77).add(salt.mul(0.113)), 3.7);
    const tile = rbHash31(home).toVar();
    const own = rbHash31(cell.zxy.add(vec3(17.13, salt.mul(0.377), 5.29)));
    const life = tile.mul(PATCH_LIFE.span).add(PATCH_LIFE.min).mul(cycle.x).toVar();
    const cycles = step(own, cycle.y);
    const k = cell.x.sub(ATLAS_ISLANDS + 1);
    const start = fract(k.mul(RIBBON_PHASE_STEP).add(fract(tile.mul(97.31)).mul(ATLAS_RIBBONS)).div(ATLAS_RIBBONS));
    const phase = fract(clock.div(life).mul(cycles).add(start)).toVar();
    const far = float(1e4).mul(float(1.0).sub(cycles));
    return vec3(
        rbAgeOfPhase(rbWarpAge(phase, bias)),
        phase.mul(life).mul(cycles).add(far),
        float(1.0).sub(phase).mul(life).mul(cycles)
            .add(far),
    );
}).setLayout({
    name: 'rb_patchAge',
    type: 'vec3',
    inputs: [
        { name: 'cell', type: 'vec3' }, { name: 'salt', type: 'float' },
        { name: 'clock', type: 'float' }, { name: 'bias', type: 'float' }, { name: 'cycle', type: 'vec2' },
    ],
});

/**
 * How much of a pixel a band [0, w] of a distance field covers at distance d, for a pixel
 * footprint fw (fwidth of d): crisp where the band is wide on screen, a faint line of the right
 * weight where it is thinner than a pixel (never a broad grey smear).
 */
export const rbBand = /* @__PURE__ */ Fn(([d, w, fw]) => {
    const aa = max(fw, 1e-5);
    return clamp(w.sub(d).div(aa).add(0.5), 0.0, 1.0).mul(min(w.div(aa), 1.0));
}).setLayout({
    name: 'rb_band',
    type: 'float',
    inputs: [{ name: 'd', type: 'float' }, { name: 'w', type: 'float' }, { name: 'fw', type: 'float' }],
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

/** The sun's light at the Bole (scene-linear); other zones tint it by their fleck colour. */
export const SUN_BOLE = Object.freeze([4.2, 3.7, 2.9]);

/**
 * Every uniform the scene's materials share, set for the Bole zone on level 4. The world owns
 * the values; materials only read. `textures` (createBarkTextures) adds the samplers.
 */
export function createRainbarkUniforms(textures = null) {
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
        /** The mist's drift (x, z metres, wrapped) and its slow boil (noise cells): mistDrift(). */
        mistDrift: uniform(new THREE.Vector3(0, 0, 0)),
        /** The grain of the mist top's billows (mistGrainAt: finer from just over the mist). */
        mistGrain: uniform(mistGrainAt(camY, zone)),
        /**
         * The cards' union on screen (x0, y0, x1, y1 fractions, y down): what falls or drifts in
         * the world keeps out of it.
         */
        cardRect: uniform(new THREE.Vector4(0.407, 0.149, 0.593, 0.851)),
        /** The air: σA at the zone's tide top (u.hazeY), its scale height, and σM inside the mist. */
        hazeY: uniform(zone.tideTop),
        sigmaA: uniform(zone.sigmaA),
        scaleHeight: uniform(zone.scaleHeight),
        sigmaM: uniform(zone.sigmaM),
        /**
         * The tide clock (tideClock): the haze's gain on rays at and above the horizon, how far above
         * the tide the vapour begins (metres), how high the water stands (0 … 1) and how it moves
         * (−1 draining fastest … 1 rising fastest).
         */
        airGain: uniform(1),
        mistOnset: uniform(TIDE_LIGHT.onset[0]),
        tideHigh: uniform(0),
        tideRise: uniform(0),
        /** The post's iris, inverted: event lights are raised by it so they read at any exposure. */
        iris: uniform(1),
        /** The sun's light (scene-linear), and the sheen's strength over the tide (0.6 … 1.0). */
        sunCol: uniform(new THREE.Vector3(SUN_BOLE[0], SUN_BOLE[1], SUN_BOLE[2])),
        sheenK: uniform(0.8),
        /** The bark's four group clocks (seconds, wrapped) and the grove's age bias per group. */
        groupClock: uniform(new THREE.Vector4(0, 0, 0, 0)),
        ageBias: uniform(new THREE.Vector4(0.4, 0.4, 0.4, 0.4)),
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
    if (textures) {
        u.tex = textures;
        /** The age ramp (linear rgb), read at texel centres from age 0 to 1. */
        u.ramp = (age) => texture(textures.ramp, vec2(clamp(age, 0.0, 1.0).mul(255 / 256).add(0.5 / 256), 0.5))
            .level(0).rgb;
        /** The four fBm bands, filtered through their mips (or at a level). */
        u.fbm = (st) => texture(textures.fbm, st);
        u.fbmLod = (st, lod = 0) => texture(textures.fbm, st).level(lod);
        /** The patch atlas: ids (nearest) and the signed edge distance (linear), never mipped. */
        u.atlasIds = (st) => texture(textures.atlasNear, st).level(0);
        u.atlasEdge = (st) => texture(textures.atlasLin, st).level(0);
        /** The canopy's leaf coverage (0 sky … 1 leaves) at a mip level. */
        if (textures.lace) u.lace = (st, lod) => texture(textures.lace, st).level(lod).r;
        /** The canopy's crowns (0 sky … 1 crown) at a mip level. */
        if (textures.crowns) u.crowns = (st, lod) => texture(textures.crowns, st).level(lod).r;
        /** 3D value noise from the 2D lattice: two independent trilinear fields, one fetch. */
        u.noise3 = (at) => {
            const cell = floor(at);
            const f0 = fract(at);
            const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0)));
            const size = textures.lattice.image.width;
            const st = cell.xy.add(vec2(LATTICE_SLICE[0], LATTICE_SLICE[1]).mul(cell.z)).add(f.xy).add(0.5).div(size);
            const t = texture(textures.lattice, st).level(0);
            return mix(t.xz, t.yw, f.z);
        };
    }
    return u;
}

/**
 * The bakes (rainbark-bake.js) as textures. The patch atlas is ONE typed array behind two views:
 * nearest for the ids (a filtered id is meaningless) and linear for the edge distance.
 */
export function createBarkTextures({
    atlas, ramp, fbm, lattice, lace = null, crowns = null,
}) {
    const textures = {
        atlasNear: createRainbarkTexture(atlas.data, atlas.size, atlas.size, {
            name: 'rainbark-atlas-ids', filter: 'nearest',
        }),
        atlasLin: createRainbarkTexture(atlas.data, atlas.size, atlas.size, {
            name: 'rainbark-atlas-edge', filter: 'linear',
        }),
        ramp: createRainbarkTexture(ramp.data, ramp.width, ramp.height, {
            name: 'rainbark-ramp', filter: 'linear', wrap: 'clamp',
        }),
        fbm: createRainbarkTexture(fbm.data, fbm.size, fbm.size, {
            name: 'rainbark-fbm', filter: 'mipmap', mipmaps: fbm.mipmaps,
        }),
        lattice: createRainbarkTexture(lattice.data, lattice.size, lattice.size, {
            name: 'rainbark-lattice', filter: 'linear',
        }),
    };
    if (lace) {
        textures.lace = createRainbarkTexture(lace.data, lace.size, lace.size, {
            name: 'rainbark-lace', filter: 'mipmap', channels: 1, mipmaps: lace.mipmaps,
        });
    }
    if (crowns) {
        textures.crowns = createRainbarkTexture(crowns.data, crowns.size, crowns.size, {
            name: 'rainbark-crowns', filter: 'mipmap', channels: 1, mipmaps: crowns.mipmaps,
        });
    }
    return textures;
}

// ── Inline builders (they read the bag) ─────────────────────────────────────────

/** The view ray through a UV of the frame (y down), from the camera uniforms. */
export const rbViewRay = (u, st) => {
    const nx = st.x.mul(2.0).sub(1.0);
    const ny = float(1.0).sub(st.y.mul(2.0));
    return u.camFwd.add(u.camRight.mul(nx.mul(u.tanHalf.x))).add(u.camUp.mul(ny.mul(u.tanHalf.y))).normalize();
};

/** How much darker the haze grows looking up toward the canopy's shade (from 6° up, full at 37°). */
export const HAZE_UPWARD_DIM = 0.2;
/**
 * The sunlit side of the air: looking toward the sun's azimuth (however high it stands) the haze
 * warms and brightens broadly, up to this share of the sunlit vapour at the horizon, so the open
 * right of the frame reads as sunlit air and not as the same grey-blue as the shade on the left.
 */
export const HAZE_SUN_SIDE = 0.3;
/**
 * The low air's glow on rays that look down. Their haze lies mostly just over the mist (the air
 * thickens toward it), where the mist's sunlit top lights it from below; so it turns toward the
 * mist's own light (half its top, half its warm underglow) and gains `add` of the underglow on
 * top, but only on a ray that meets the mist's top near: fully within `near` metres, none beyond
 * `far` (both for an eye `ref` metres over the mist, and scaled with the eye's height over the mean
 * of the zone's tide top u.hazeY and the tide, at least `least`: the glow keeps to the bottom of the
 * frame on every storey, and the tide moves it only half as far as the mist itself moves). At the
 * Bole's rest that is the bottom ~15% of the frame; the band
 * from the horizon down stays the blue-lavender air the ghost grove dissolves in, the mist only
 * glimmering through it (a cream field running out to the horizon reads as a sea of cloud, §9 #4).
 * The glow's share is `mix` of the way to the mist's light, times how high the water stands
 * (exp((tide − top)/`tide`)), never under `floor` of that (at low water the floor stays cream on
 * blue, only lower and a little fainter) nor over `most`. As the water rises the glow climbs the
 * frame (the mist nearer at every angle) and strengthens; as it drains it sinks and fades. (§4.4 adds 0.35 of the underglow from 27° down whatever the mist
 * does; through the blue haze that reads lavender, or grey, over the mist, never the cream vapour
 * of §2.1.)
 */
export const HAZE_UNDERGLOW = Object.freeze({
    near: 71, far: 150, ref: 25, least: 6, mix: 0.7, floor: 1.35, most: 0.95, add: 0.05, tide: 17,
});

/**
 * The light the air scatters toward the eye along a direction (§4.4): blue-violet shade, warming
 * to sunlit vapour toward the sun (Henyey–Greenstein forward scatter, and broadly on the sun's side
 * of the sky), and the mist's glow on rays that look down and meet it near (HAZE_UNDERGLOW).
 */
export function rbInscatter(u, dir) {
    const G = HAZE_UNDERGLOW;
    const toward = rbHgMix(dot(dir, u.sunDir), float(0.55));
    const flat = dir.xz.div(max(length(dir.xz), 1e-3));
    const side = smoothstep(-0.2, 0.9, dot(flat, normalize(u.sunDir.xz))).mul(float(1.0).sub(abs(dir.y)));
    const span = max(u.camPos.y.sub(mix(u.hazeY, u.tide, 0.5)), G.least).div(G.ref).toVar();
    const toMist = max(u.camPos.y.sub(u.tide), 0.5).div(max(dir.y.negate(), 1e-3));
    const down = float(1.0).sub(smoothstep(span.mul(G.near), span.mul(G.far), toMist)).toVar();
    // A touch darker upward, toward the canopy's shade (every part's air agrees with the backdrop).
    const up = smoothstep(0.1, 0.6, dir.y).mul(HAZE_UPWARD_DIM);
    const haze = mix(mix(u.col.hazeShade, u.col.hazeSun, toward), u.col.hazeSun, side.mul(HAZE_SUN_SIDE));
    const glow = mix(u.col.underglow, u.col.mistTop, 0.5);
    const risen = exp(clamp(u.tide.sub(u.hazeY).div(G.tide), -2.0, 2.0)).toVar();
    const share = min(max(risen, G.floor).mul(G.mix), G.most).mul(down);
    const lowAir = mix(haze.mul(float(1.0).sub(up)), glow, share);
    return lowAir.add(u.col.underglow.mul(max(risen, G.floor).mul(down).mul(G.add)));
}

/**
 * The mist floor's density ramp: from nothing u.mistOnset metres above the tide (the tide clock's
 * onset: higher at high water, so immersion swallows the trunks' feet higher) to full this many
 * metres below it (a closed-form ramp, not a step), so trunk feet fade into the vapour over a long
 * band that varies with depth instead of all ending on one line.
 */
export const MIST_DEPTH = 13;
/**
 * The mist's light against the air's, after the haze in front of it: its luminance never more than
 * `lift` times the light the air in front of it scatters, rolled off softly from `knee` of that (a
 * crest flattens into a glow, never a clipped plate). A flat field brighter than everything would
 * pull the eye off the card and read as a lake.
 */
export const MIST_LIFT = Object.freeze({ lift: 1.9, knee: 0.9 });
/**
 * The mist top's billows (§4.4 item 4): a lattice noise of `scale` cells a metre on the top's plane
 * (times the grain, u.mistGrain: finer where the eye stands just over the mist), drifting
 * with u.mistDrift and boiling at `boil[0]` times its boil, and a second octave `second` times
 * finer weighing `weight` (boiling at `boil[1]` times; Low and Minimal drop it). They are shaded by
 * their slope to the sun, not by thresholding their dips: the field read again `slope` cells
 * toward the sun's azimuth, the drop to there over `slopeRange` is a front facing the sun (lit, up
 * to `lit` brighter) and a rise a lee side turned from it: a connected network of lit fronts and
 * lees, never isolated round pools. `crest` of the light comes from the height itself (over the
 * wide ramp `ramp`; a narrow cut of a noise is confetti), so the low ground between billows is in
 * shade as a whole; where the light falls the lee turns blue (MIST_HOLLOW). Where a
 * pixel covers more than `fade` of an octave's cells on the plane, that octave melts into its mean,
 * and on a ray within `graze` (|dir.y|) of the horizontal the whole pattern does (squashed that
 * flat, a billow could only read as a streak).
 */
export const MIST_BILLOWS = Object.freeze({
    scale: 0.03,
    second: 2.3,
    weight: 0.45,
    boil: Object.freeze([1, 2]),
    slope: 0.4,
    slopeRange: 0.16,
    lit: 1.25,
    crest: 0.45,
    ramp: Object.freeze([0.2, 0.8]),
    fade: Object.freeze([0.06, 0.25]),
    graze: Object.freeze([0.06, 0.28]),
});
/**
 * Until the canopy's gobo lands on it, broad pools of sunlight lie on the mist where the sun ray
 * from it crosses the canopy plane: the fBm's broadest band on a `tile` metre tile, cut over `cut`
 * and read at a fixed `level`; a pool lifts the top by up to `gain`. Where a pixel covers more than
 * `fade` metres of the plane the pools melt into their `mean` (the cut band's mean over the bake),
 * and on a grazing ray they melt as the billows do (MIST_BILLOWS.graze): a ray near the horizon
 * meets the plane so far off, and so slanted, that the pools would only lie in horizontal bands.
 */
export const MIST_POOLS = Object.freeze({
    tile: 150, cut: Object.freeze([0.4, 0.72]), level: 2, gain: 0.9, fade: Object.freeze([12, 45]), mean: 0.5,
});
/**
 * A billow's lee side (from a slope of `from` toward the sun's opposite, full at the steepest)
 * turns up to `blue` of the way to a blue shadow: the shade haze's hue (`hue` of it, the rest
 * grey: a deep zone's saturated shade would read as periwinkle puddles) at its own lightness; it
 * is `dim` as much dimmer as a lit front is brighter (a shadow on vapour is cool more than dark:
 * dimmed as far as a front is lit, cream would only turn grey).
 */
export const MIST_HOLLOW = Object.freeze({
    blue: 0.6, hue: 0.65, dim: 0.75, from: 0.15,
});
/**
 * The billows' and pools' light carried by the haze over the mist: `pattern` of their relative
 * light and `hollow` of the lees' blue, as far as the haze veils the top. The air over a sunlit
 * pool is itself in the sun (the canopy's light comes down through it), the air over a lee in
 * its shade; so the pattern survives the long slant down to the mist, which the veil alone would
 * wash out to a flat grey. Only the near air carries it: where less than `fade` of the top shows
 * through the haze (toward the horizon) it melts away, as the far billows would only streak.
 */
export const MIST_AIR_PATTERN = Object.freeze({ pattern: 1.0, hollow: 1.0, fade: Object.freeze([0.12, 0.4]) });
/**
 * The mist top's own light (times its colour) before its billows and pools: held a little under
 * white, so its lit fronts and pools can rise over it before the tone curve flattens them.
 */
export const MIST_TOP_LIGHT = 0.8;
/** The bark above tints the mist top under it (the R1/R2 group's mean hue), this much (§0.2). */
export const MIST_BLEED = 0.08;
/**
 * The vapour seen from inside the mist (the Fog Line, Mistfall): pearly and high-key. Its
 * lightness is `bright` of the way from the shade haze's to the mist top's; its hue a cool pearl
 * (`pearl` of the way from the shade haze to the mist top), warming to cream (the top gilded by
 * the sun's colour, `cream`) only within about 35° of the sun's azimuth (`sunSide`, the cosine's
 * ramp, up to `side` of the way) and glowing toward the sun itself (`glow`, forward scatter in the
 * vapour); brighter looking up, by `up`, and by up to `top` more as its lit top nears overhead
 * (from 14 m to 2 m above the eye); darker and a little cooler looking down into its depth, by up
 * to `down`. Its density varies slowly: one octave of lattice noise along the view ray `grain`
 * metres out (cells as large), drifting with the mist, ±`vary` of its light. Inside the mist the
 * vapour is the air: `haze` of the clear haze under the zone's tide top is not counted there (so
 * the first rank, 45 m off, still stands as a ghost while trunks dissolve within 60 m).
 */
export const MIST_INTERIOR = Object.freeze({
    bright: 0.93,
    pearl: 0.4,
    cream: 0.55,
    sunSide: Object.freeze([0.62, 0.94]),
    side: 0.8,
    glow: 0.12,
    up: 0.25,
    top: 0.45,
    down: 0.3,
    grain: 25,
    vary: 0.07,
    haze: 1.0,
});
/**
 * How far below the tide (metres) the backdrop paints the mist's vapour: some way into the mist,
 * where its density has built up, not on the tide's plane. The haze runs only to that plane on any
 * ray that goes deeper (the backdrop's ray ends there), so a trunk sinking past it melts into the
 * very pixel painted round it.
 */
export const MIST_SEEN_DEPTH = MIST_DEPTH * 0.6;
/**
 * In the middle distance the air keeps some of a colour's hue as it pales it (pastel, not grey):
 * `keep` of the colour's own chroma comes back, and the air's own hue turned toward violet (the
 * shade haze times `violet`) lends it `tint` of the light's chroma, most where the haze is half
 * through, so R3 reads as a pastel and R4 as a blue-violet ghost, not one slate blue-grey.
 */
export const AIR_PASTEL = Object.freeze({
    keep: 0.8, tint: 0.75, violet: Object.freeze([1.3, 0.9, 1.0]),
});

/**
 * The mist's warm bounce on the bark fades over this many metres above its top (§2.4 says 25 with
 * the Bole's top at 38 m; the build's top stands 12 m lower, so the glow reaches as far up the
 * trunks at eye height as the spec's did).
 */
export const BOUNCE_HEIGHT = 35;
/**
 * The bounce as the painting needs it (§2.1: the Elder's shade half lit from below by the mist):
 * its colour `warm` of the way from the underglow to the sun's and then `ember` of the way on to
 * a deeper warm (the slate it lands on is blue, and only a warm well past cream turns it so), and
 * up to `eye` times more below the eye (full `below` metres under it, none `above` over it; on
 * bark facing the sun only `lit` of that), `dim` less over it: the floor fills more of the view of
 * bark below the eye and less of bark above, and the glow must read where the frame shows the
 * bark plunging toward it, against the cool shade above.
 */
export const BOUNCE = Object.freeze({
    warm: 0.7, ember: 0.6, eye: 0.6, lit: 0.35, dim: 0.6, below: 4, above: 3, glaze: 0.34,
});
/** The deeper warm the bounce leans to (linear rgb): a sunlit cream seen against blue shade. */
const BOUNCE_EMBER = [1.0, 0.62, 0.28];
/**
 * The sky's fill on bark: down below the eye the crowns and the trunks around hide more of the
 * sky, so its cool fill falls to `low` of itself `from` metres under the eye (full `to` metres
 * over it) and the mist's warm bounce beats it; over the eye it is the canopy's blue skylight,
 * cooled by `cool` (channel gains) so the shade above reads blue against the warm glow below.
 */
export const SKY_FILL_LOW = Object.freeze({
    low: 0.25, from: -6, to: 14, cool: Object.freeze([0.8, 0.94, 1.18]),
});

/** How much the bark's sheen sees of the mist's top, against its own light (seen low, hazed). */
export const SHEEN_FLOOR = 0.85;

/** How far the camera stands inside the mist (0 above its top … 1 a couple of metres under it). */
export const rbMistInside = (u) => smoothstep(-2.0, 2.0, u.tide.sub(u.camPos.y));

/** The bounce's colour (BOUNCE: past the underglow toward the sun's, then toward a deeper warm). */
export const rbBounceColor = (u) => mix(
    mix(u.col.underglow, u.col.fleck, BOUNCE.warm),
    vec3(...BOUNCE_EMBER),
    BOUNCE.ember,
);

/** How far below the eye a height is, for the bounce (0 BOUNCE.above over it … 1 BOUNCE.below under it). */
export const rbBelowEye = (u, y) => float(1.0).sub(smoothstep(u.camY.sub(BOUNCE.below), u.camY.add(BOUNCE.above), y));

/**
 * The mist's warm bounce at a height (§2.4): BOUNCE's colour, fading over BOUNCE_HEIGHT metres
 * above the mist's top, lifted below the eye and dimmed above it (BOUNCE); `facing` (bark that
 * faces down takes more) and `away` (0 … 1, how far the bark is turned from the sun: the shade
 * side takes the whole lift). Shared by the trunks and the backdrop's ghost grove, so the two glow
 * alike.
 */
export function rbBounce(u, y, facing, away) {
    const above = clamp(y.sub(u.tide), 0.0, 400.0);
    const col = rbBounceColor(u);
    const below = rbBelowEye(u, y).toVar();
    const lift = below.mul(mix(float(BOUNCE.lit), float(1.0), away)).mul(BOUNCE.eye);
    const eye = lift.sub(float(1.0).sub(below).mul(BOUNCE.dim)).add(1.0);
    return col.mul(exp(above.div(-BOUNCE_HEIGHT))).mul(facing).mul(eye);
}

/**
 * The floor's glaze on satin bark below the eye: a broad reflection of the lit mist (its top's and
 * underglow's light, BOUNCE.glaze of it, fading over BOUNCE_HEIGHT above the mist), on the shade
 * side (`away`) most. Added to the bark's light, not multiplied by its albedo: on blue slate the
 * multiplied bounce alone only greys it, the glaze turns it warm (§2.1: the shade half lit from
 * below by a warm glow off the mist floor).
 */
export function rbGlaze(u, y, away) {
    const above = clamp(y.sub(u.tide), 0.0, 400.0);
    const glow = mix(mix(u.col.mistTop, u.col.underglow, 0.5), rbBounceColor(u), 0.5);
    const k = rbBelowEye(u, y).mul(mix(float(BOUNCE.lit), float(1.0), away)).mul(BOUNCE.glaze);
    return glow.mul(exp(above.div(-BOUNCE_HEIGHT)).mul(k));
}

/** The sky's fill at a height (SKY_FILL_LOW): its share, and over the eye its cooler blue. */
export const rbSkyFill = (u, y) => {
    const over = smoothstep(u.camY.add(SKY_FILL_LOW.from), u.camY.add(SKY_FILL_LOW.to), y);
    return mix(vec3(SKY_FILL_LOW.low), vec3(...SKY_FILL_LOW.cool), over);
};

/**
 * How much of a point's own light the mist over it has taken (0 above the vapour … 1 deep in it):
 * the sun's path down through the vapour's density ramp to it, in closed form. A trunk's foot
 * plunging into the mist loses its sunlit side, its sky and its warm bounce to the vapour's
 * diffuse light round it (MIST_DROWN_LIGHT of the mist top's): a silhouette melting into the
 * light, never a pale pillar standing in it.
 */
export function rbDrown(u, y) {
    const W = u.mistOnset.add(MIST_DEPTH).toVar();
    const h = clamp(u.tide.add(u.mistOnset).sub(y).div(W), 0.0, 40.0).toVar();
    const c = min(h, 1.0);
    const phi = c.mul(c).mul(0.5).add(max(h.sub(1.0), 0.0));
    return float(1.0).sub(exp(min(u.sigmaM.mul(W).mul(phi).div(max(u.sunDir.y, 0.2)), 30.0).negate()));
}
/** The light round a point drowned in the mist (rbDrown): this share of the mist top's own. */
export const MIST_DROWN_LIGHT = 0.8;

/** The mist top's flat field (no light, no lee, the pools' mean): what its billows melt into far off. */
export const rbMistFlat = () => vec3(0.0, 0.0, MIST_POOLS.mean);

/**
 * The mist top's field along a downward direction (§4.4 item 4), where the ray meets the plane the
 * vapour is painted on (MIST_SEEN_DEPTH into the mist): vec3(light −1 … 1, lee 0 … 1, pool 0 … 1).
 * `billows` octaves of drifting, boiling lattice noise (MIST_BILLOWS), shaded by their slope to the
 * sun, and the sun's broad pools (MIST_POOLS), each melting into the flat field (rbMistFlat) where a
 * pixel covers too much of it; `billows: 0` is the flat field itself (no texture read). The
 * backdrop and every point sinking into the mist read it the same way along their own ray, so a
 * foot melts into the very pixel painted round it.
 */
export function rbMistField(u, dir, { billows = 2 } = {}) {
    if (!billows) return rbMistFlat();
    const B = MIST_BILLOWS;
    const downY = max(dir.y.negate(), 1e-3).toVar();
    const seenY = u.tide.sub(MIST_SEEN_DEPTH);
    const t = min(clamp(u.camPos.y.sub(seenY), 0.5, 1e4).div(downY), 1e5).toVar();
    const hit = u.camPos.xz.add(dir.xz.mul(t)).toVar();
    const foot = t.mul(u.pixelAngle).div(max(downY, 0.02)).toVar();
    const scale = u.mistGrain.mul(B.scale).toVar();
    const cells = foot.mul(scale).toVar();
    const graze = smoothstep(B.graze[0], B.graze[1], downY).toVar();
    const fine = float(1.0).sub(smoothstep(B.fade[0], B.fade[1], cells)).mul(graze).toVar();
    const p = hit.add(u.mistDrift.xy).mul(scale).toVar();
    // The step toward the sun's azimuth, in cells of either octave.
    const toSun = normalize(u.sunDir.xz).mul(B.slope).toVar();
    const boil1 = u.mistDrift.z.mul(B.boil[0]);
    let h = u.noise3(vec3(p, boil1)).x;
    let hs = u.noise3(vec3(p.add(toSun), boil1)).x;
    if (billows > 1) {
        const p2 = p.mul(B.second).add(vec2(17.3, 41.9)).toVar();
        const boil2 = u.mistDrift.z.mul(B.boil[1]).add(5.0);
        const fine2 = float(1.0).sub(smoothstep(B.fade[0], B.fade[1], cells.mul(B.second))).toVar();
        const n2 = u.noise3(vec3(p2, boil2)).y;
        const n2s = u.noise3(vec3(p2.add(toSun), boil2)).y;
        h = mix(h, mix(float(0.5), n2, fine2), B.weight);
        hs = mix(hs, mix(float(0.5), n2s, fine2), B.weight);
    }
    const hv = h.toVar();
    // Falling toward the sun: a front facing it; rising: a lee turned from it.
    const slope = clamp(hv.sub(hs).div(B.slopeRange), -1.0, 1.0).mul(fine).toVar();
    const crest = smoothstep(B.ramp[0], B.ramp[1], hv).sub(0.5).mul(2.0).mul(fine);
    const light = clamp(slope.mul(1 - B.crest).add(crest.mul(B.crest)), -1.0, 1.0).toVar();
    // The lee: wherever the light falls (a slope turned from the sun, and the low ground between
    // billows as a whole, so a dip is one soft shadow, never a lit floor inside a dark ring).
    const lee = smoothstep(MIST_HOLLOW.from, 1.0, light.negate());
    // The sun's broad pools: where the sun ray from the mist crosses the canopy plane.
    const up = u.canopyY.sub(seenY).div(max(u.sunDir.y, 0.2));
    const q = hit.add(u.sunDir.xz.mul(up)).div(MIST_POOLS.tile).add(vec2(0.13, 0.57));
    const pooled = smoothstep(MIST_POOLS.cut[0], MIST_POOLS.cut[1], u.fbmLod(q, MIST_POOLS.level).r);
    const poolFine = float(1.0).sub(smoothstep(MIST_POOLS.fade[0], MIST_POOLS.fade[1], foot)).mul(graze);
    return vec3(light, lee, mix(float(MIST_POOLS.mean), pooled, poolFine));
}

/**
 * A colour shaded by the mist top's field: lit by its fronts and pools against the flat top
 * (`kLift` of the way: fronts and pools brighter, lees dimmer; 1 on the flat field), and its lees
 * turned toward the shade haze's blue at their own lightness (`kHollow` of MIST_HOLLOW).
 */
export function rbMistShade(u, col, field, kLift, kHollow) {
    const flatLift = 1 + MIST_POOLS.gain * MIST_POOLS.mean;
    const x = field.x.toVar();
    const lift = max(x, 0.0).mul(MIST_BILLOWS.lit).sub(max(x.negate(), 0.0).mul(MIST_HOLLOW.dim)).add(1.0)
        .mul(field.z.mul(MIST_POOLS.gain).add(1.0))
        .div(flatLift);
    const lit = col.mul(mix(float(1.0), lift, kLift)).toVar();
    const l = rbLuma(lit).toVar();
    const shadeHue = mix(vec3(l), u.col.hazeShade.mul(l.div(max(rbLuma(u.col.hazeShade), 1e-4))), MIST_HOLLOW.hue);
    return mix(lit, shadeHue, field.y.mul(kHollow).mul(MIST_HOLLOW.blue));
}

/**
 * The mist floor's lit top along a downward direction (§4.4 item 4): cream, brighter toward the
 * sun, at the pools' mean lift, faintly tinted by the bark above (MIST_BLEED); then shaded by its
 * field (rbMistField: the billows' lit fronts and blue lees, the sun's pools).
 */
export function rbMistTop(u, dir, field) {
    const forward = u.col.hazeSun.mul(rbHgMix(dot(dir, u.sunDir), float(0.6)).mul(0.25));
    const raw = u.col.mistTop.mul(MIST_TOP_LIGHT).add(forward);
    const mean = u.palette.element(int(PALETTE_ROWS.groupMean + 1)).xyz;
    const tint = mix(vec3(1.0), mean.div(max(rbLuma(mean), 1e-4)), MIST_BLEED);
    const base = raw.mul(tint).mul(1 + MIST_POOLS.gain * MIST_POOLS.mean);
    return rbMistShade(u, base, field, float(1.0), float(1.0));
}

/**
 * The vapour seen from inside the mist (the Fog Line, Mistfall), MIST_INTERIOR: a cool, high-key
 * pearl, cream only toward the sun's azimuth, glowing toward the sun and toward its lit top
 * overhead (the more the nearer it is), a little darker looking down into its depth, its density
 * varying slowly along the ray.
 */
export function rbMistInterior(u, dir) {
    const I = MIST_INTERIOR;
    const bright = mix(rbLuma(u.col.hazeShade), rbLuma(u.col.mistTop), I.bright).toVar();
    const hue = (c) => c.mul(bright.div(max(rbLuma(c), 1e-4)));
    const pearl = hue(mix(u.col.hazeShade, u.col.mistTop, I.pearl));
    const flat = dir.xz.div(max(length(dir.xz), 1e-3));
    const side = smoothstep(I.sunSide[0], I.sunSide[1], dot(flat, normalize(u.sunDir.xz))).mul(I.side);
    const cream = hue(mix(u.col.mistTop, u.col.fleck, I.cream));
    const lit = mix(pearl, cream, side).toVar();
    // Its density, slowly varying along the ray (cells `grain` metres across, drifting with the mist).
    const q = u.camPos.add(dir.mul(I.grain)).div(I.grain);
    const at = vec3(
        q.x.add(u.mistDrift.x.div(I.grain)),
        q.z.add(u.mistDrift.y.div(I.grain)),
        q.y.add(u.mistDrift.z),
    );
    const vary = u.noise3(at).x.sub(0.5).mul(2 * I.vary).add(1.0);
    const near = float(1.0).sub(smoothstep(2.0, 14.0, u.tide.sub(u.camPos.y)));
    const up = smoothstep(-0.15, 0.6, dir.y).mul(near.mul(I.top).add(I.up));
    const down = smoothstep(0.0, 0.5, dir.y.negate()).mul(I.down).toVar();
    const deep = mix(lit, u.col.hazeShade.mul(rbLuma(lit).div(max(rbLuma(u.col.hazeShade), 1e-4))), down);
    const glow = u.col.fleck.mul(rbHgMix(dot(dir, u.sunDir), float(0.5)).mul(I.glow));
    return deep.mul(float(1.0).sub(down).add(up)).mul(vary).add(glow);
}

/**
 * The vapour the mist floor shows along a direction: its lit top shaded by `field` (rbMistTop), or
 * from inside the mist its interior. Which one is a branch on the camera alone (coherent over the
 * frame), so only a camera at the mist's top pays for both.
 */
export function rbVapour(u, dir, field) {
    const inside = rbMistInside(u).toVar();
    const out = vec3(0.0).toVar();
    If(inside.lessThan(0.999), () => {
        out.assign(rbMistTop(u, dir, field));
    });
    If(inside.greaterThan(0.001), () => {
        out.assign(mix(out, rbMistInterior(u, dir), inside));
    });
    return out;
}

/**
 * Transmittance of the air from the camera (§4.4), as vec2 (haze, mist): the haze to the point
 * `hazeAt` (P unless given: the backdrop's ray ends at the plane it paints the mist on, and so
 * does the haze in front of anything sunk past it), the mist to P itself. The haze is closed form
 * through the height-falling profile (σA·exp(−(y − top)/Hs) from the zone's tide top, u.hazeY:
 * the haze stands still while the tide breathes, so the risen mist reads nearer, not hazier; the
 * tide clock's air gain thickens it on rays at and above the horizon; inside the mist the vapour
 * is the air, MIST_INTERIOR.haze), the mist through its density ramp from u.mistOnset over the
 * tide to MIST_DEPTH under it (the mean of the ramp along the ray, in closed form). Every exponent
 * is bounded.
 */
export function rbAirTransmittance2(u, P, hazeAt = null) {
    const Q = hazeAt || P;
    const V = Q.sub(u.camPos).toVar();
    const d = max(length(V), 1e-4).toVar();
    const Vy = V.y.div(d).toVar();
    const Hs = u.scaleHeight;
    // From the eye's own height (breath and all): integrated from anywhere else, a ray that
    // barely climbs would divide a finite difference by almost nothing at the horizon.
    const eyeY = u.camPos.y;
    const a0 = clamp(eyeY.sub(u.hazeY).div(Hs), -8.0, 40.0);
    const a1 = clamp(Q.y.sub(u.hazeY).div(Hs), -8.0, 40.0);
    const e0 = exp(max(a0, 0.0).negate()).toVar();
    const e1 = exp(max(a1, 0.0).negate()).toVar();
    // Above the tide top the haze falls off exponentially (closed form); below it, it holds at σA
    // over the share of the ray that runs there (from inside the mist, a ray that barely climbs
    // would otherwise meet no haze at all and part from the level one in a line at the horizon),
    // less what the mist's own vapour stands for when the camera is in it.
    const clear = float(1.0).sub(rbMistInside(u).mul(MIST_INTERIOR.haze)).toVar();
    // A ray that barely climbs: the haze at the camera's height over the whole distance (under the
    // tide top, as clear of the vapour's share as a slanting ray is, so the two meet at the horizon).
    const level = u.sigmaA.mul(mix(e0, clear, step(eyeY, u.hazeY))).mul(d);
    const VyS = select(Vy.lessThan(0.0), min(Vy, -1e-3), max(Vy, 1e-3)).toVar();
    const lowY = min(eyeY, Q.y);
    const highY = max(eyeY, Q.y);
    const underTide = max(u.hazeY.sub(lowY), 0.0).sub(max(u.hazeY.sub(highY), 0.0)).div(max(highY.sub(lowY), 1e-4));
    const slanted = u.sigmaA.mul(Hs).mul(e0.sub(e1)).div(VyS)
        .add(u.sigmaA.mul(d).mul(clamp(underTide, 0.0, 1.0)).mul(clear));
    // The tide's air gain, on rays at and above the horizon only: the risen mist below reads
    // nearer and brighter, never hazier.
    const gain = mix(float(1.0), u.airGain, smoothstep(-0.1, 0.05, Vy));
    const tauA = select(abs(Vy).greaterThan(1e-3), slanted, level).mul(gain);
    // The mist's ramp h = (tide + onset − y)/W, clamped to 0..1; Φ(h) = ∫₀ʰ ramp is its integral.
    const dM = hazeAt ? max(length(P.sub(u.camPos)), 1e-4) : d;
    const W = u.mistOnset.add(MIST_DEPTH).toVar();
    const top = u.tide.add(u.mistOnset);
    const h0 = clamp(top.sub(eyeY).div(W), -40.0, 40.0).toVar();
    const h1 = clamp(top.sub(P.y).div(W), -40.0, 40.0).toVar();
    const phi = (h) => {
        const c = clamp(h, 0.0, 1.0);
        return c.mul(c).mul(0.5).add(max(h.sub(1.0), 0.0));
    };
    const dh = h1.sub(h0).toVar();
    const meanSlant = abs(phi(h1).sub(phi(h0))).div(max(abs(dh), 1e-4));
    const meanLevel = clamp(h0.add(h1).mul(0.5), 0.0, 1.0);
    const mean = select(abs(dh).greaterThan(0.004), meanSlant, meanLevel);
    const tauM = u.sigmaM.mul(dM).mul(mean);
    return vec2(exp(min(max(tauA, 0.0), 30.0).negate()), exp(min(max(tauM, 0.0), 30.0).negate()));
}

/** Transmittance of the haze and the mist together, from the camera to a point. */
export function rbAirTransmittance(u, P) {
    const T = rbAirTransmittance2(u, P);
    return T.x.mul(T.y);
}

/**
 * A colour seen through transmittances T (haze, mist): the mist's vapour first, then the light in
 * front of it (the haze's, or from inside the mist the vapour's own).
 */
export function rbAirOver(col, T, front, vapour) {
    const seen = col.mul(T.y).add(vapour.mul(float(1.0).sub(T.y)));
    return seen.mul(T.x).add(front.mul(float(1.0).sub(T.x)));
}

/**
 * The share of the ray from the camera to P that the haze runs over: all of it, unless P lies
 * below the plane the backdrop paints the mist's vapour on (MIST_SEEN_DEPTH under the tide); then
 * only to that plane, where the backdrop's own ray down ends (from at least half a metre above it).
 */
export function rbMistReach(u, P) {
    const eyeY = u.camPos.y;
    const seenY = u.tide.sub(MIST_SEEN_DEPTH);
    return clamp(max(eyeY.sub(seenY), 0.5).div(max(eyeY.sub(P.y), 1e-3)), 0.0, 1.0);
}

/**
 * The mist's top seen through the haze, finished: the haze over it carries the field's light
 * (MIST_AIR_PATTERN, as far as it veils the top: `Tx` is the haze's transmittance), then the light
 * rolls off against the air's in front of it (MIST_LIFT). `w` is how much of the pixel is the
 * mist's vapour (a point sunk into it); a pixel with none is untouched.
 */
export function rbMistAir(u, over, field, Tx, front, w) {
    const near = smoothstep(MIST_AIR_PATTERN.fade[0], MIST_AIR_PATTERN.fade[1], Tx);
    const veil = float(1.0).sub(Tx).mul(near).mul(w)
        .toVar();
    const kLift = veil.mul(MIST_AIR_PATTERN.pattern);
    const shaded = rbMistShade(u, over, field, kLift, veil.mul(MIST_AIR_PATTERN.hollow)).toVar();
    const cap = rbLuma(front).mul(MIST_LIFT.lift);
    const knee = cap.mul(MIST_LIFT.knee).toVar();
    const span = max(cap.sub(knee), 1e-4);
    const l = max(rbLuma(shaded), 1e-4).toVar();
    const rolled = knee.add(span.mul(float(1.0).sub(exp(max(l.sub(knee), 0.0).div(span).negate()))));
    return mix(shaded, shaded.mul(min(l, rolled).div(l)), w);
}

/**
 * A colour seen through the air from the camera to the point P (§4.4): the haze in front, then,
 * for a point down in the mist floor, the mist itself. A point sinking into the mist fades into
 * its vapour as the mist's own transmittance along its ray falls (its ramp in closed form, so a
 * trunk's foot plunges on into the vapour as a fading ghost, never ending on one line); the vapour
 * it fades into is the mist's top as the backdrop paints it along this very ray (rbMistField with
 * `billows` octaves, read only where the point is under the mist's top), and the haze in front of
 * it runs only as far as the backdrop's own ray down, so a foot lost in the mist is exactly the
 * pixel painted round it. The haze over the vapour carries the billows' light (rbMistAir). From
 * inside the mist there is no top: the vapour is the mist's interior, the air runs all the way,
 * and the light in front of a point is the vapour's own. `pre` hands in what the caller already
 * has along P's direction: { inscatter, vapour (the mist's light along it), field (its field) };
 * `opaque` says P is the vapour itself (the backdrop's ray down). Away from the mist, in the middle
 * distance, the haze leaves some of the colour's hue and lends it the air's own (AIR_PASTEL).
 */
export function rbAir(u, col, P, pre = null, { billows = 2, opaque = false } = {}) {
    const inside = rbMistInside(u).toVar();
    const reach = mix(rbMistReach(u, P), float(1.0), inside);
    const seen = u.camPos.add(P.sub(u.camPos).mul(reach));
    const T = rbAirTransmittance2(u, P, seen).toVar();
    let inscatter;
    let vapour;
    let field;
    if (pre) {
        ({ inscatter, vapour } = pre);
        field = pre.field || rbMistFlat();
    } else {
        const dir = P.sub(u.camPos).normalize().toVar();
        inscatter = rbInscatter(u, dir).toVar();
        field = vec3(rbMistFlat()).toVar();
        if (billows > 0) {
            // The billows are read only where a point is under the mist's top (from inside the
            // mist there is no top to ripple).
            If(P.y.lessThan(u.tide.add(u.mistOnset)).and(inside.lessThan(0.999)), () => {
                field.assign(rbMistField(u, dir, { billows }));
            });
        }
        vapour = rbVapour(u, dir, field).toVar();
    }
    const front = mix(inscatter, vapour, inside).toVar();
    const over = rbAirOver(col, T, front, vapour).toVar();
    // How much of the pixel is the mist's vapour (none from inside: there it is the air).
    const sunk = opaque ? float(1.0) : float(1.0).sub(T.y);
    const w = sunk.mul(float(1.0).sub(inside)).toVar();
    const midway = T.x.mul(float(1.0).sub(T.x)).mul(float(1.0).sub(w)).toVar();
    const violet = u.col.hazeShade.mul(vec3(...AIR_PASTEL.violet));
    const tint = violet.sub(vec3(rbLuma(violet))).div(max(rbLuma(violet), 1e-4)).mul(rbLuma(over));
    const pastel = col.sub(vec3(rbLuma(col))).mul(AIR_PASTEL.keep).add(tint.mul(AIR_PASTEL.tint)).mul(midway);
    return rbMistAir(u, over.add(pastel), field, T.x, front, w);
}

/** How much of the canopy plane the crowns cover where no lace is baked (the rest is sky). */
const CANOPY_COVER = 0.72;
/** How far below the canopy plane (metres) a trunk starts to dissolve into it (twice: its shade). */
export const CANOPY_SHADE = 14;
/** The same for the far grove (its tops seen from below melt into the lace over a longer climb). */
export const CANOPY_SHADE_FAR = 30;
/**
 * The canopy's openings show toward the zenith: none below the first sine of elevation (25°: at
 * the Bole's 16:9 rest they stay in the top eighth of the frame), all of them from the second
 * (on top of the crown layer's own depth, which closes narrow openings first). Between, the
 * openings thin out: their cut rises by CANOPY_GAP_CUT (a hole is crisp or shut, never a dim
 * translucent patch, which reads as a cloud).
 */
const CANOPY_GAPS = [0.43, 0.62];
const CANOPY_GAP_CUT = Object.freeze({ holes: 0.5, pins: 0.2 });
/** Just under the canopy (`under`), the gaps open this much lower (in sine of elevation). */
const CANOPY_GAPS_UNDER = 0.22;
/**
 * Along the ray (metres), the canopy fades from its near look (crown green, backlit leaf edges)
 * to its far one: the crowns' mean seen through their own shade, a dark cool blue (this share of
 * the shade haze, a little of the crown's green), so the top of the frame at the Bole is a high,
 * dark lace and never a murky green lid (nor green water at Crown Light).
 */
const CANOPY_FAR = [40, 140];
const CANOPY_MEAN = 0.2;
const CANOPY_FAR_CROWN = 0.12;
/** The tile (metres) of the noise that rags a hole's rim with leaf clusters. */
const CANOPY_RAG = 24;
/**
 * How far the clearings (a larger, turned crown tile) move the big holes' threshold: a little, so
 * the holes never fall in the crown tile's lattice without opening cloud-sized patches.
 */
const CANOPY_CLEARING = 0.6;
/**
 * The pinholes: many small openings (a few metres) where the leaf clusters part, the most of
 * them along the crowns' channels and in loose drifts: a noise of this tile (metres), turned, cut
 * at `cut` (`shy` lowers the cut by that much in a channel, `cluster` moves it with the noise's
 * broad band). Read at the footprint's mip, a pinhole under a pixel melts into the canopy's mean
 * instead of sparkling.
 */
const CANOPY_PIN = Object.freeze({
    tile: 110, cut: 0.68, shy: 0.15, turn: 1.1, cluster: 0.35,
});
/** Leaf clusters crowd an opening's rim: a ring this much darker round every hole. */
const CANOPY_RIM_DARK = 0.65;
/** How much the leaves themselves (the lace) rag an opening's rim, at the pixel's own scale. */
const CANOPY_LEAF_RAG = 0.2;
/**
 * Far, the crowns are not flat: the lace's clumps (at the footprint's mip) mottle them by this
 * much either way, and the channels between crowns let this share of the light through (toward
 * the zenith), a faint network of seams the pinholes string along.
 */
const CANOPY_CLUMPS = 0.12;
const CANOPY_SEAMS = 0.15;
/** Seen through a far opening, leaf clusters cross the light: covering this share of it. */
const CANOPY_SILHOUETTE = 0.6;
/** Inside a crown, this share of the lace's holes shows sky (the channels and holes show all). */
const CANOPY_SPECKS = 0.22;
/** The backlit edge of a leaf: the crown's green, translucent, a little warm (#6E9A4A at the Bole). */
const BACKLIT_GAIN = 3.6;
const BACKLIT_WARM = [0.06, 0.09, 0.0];
/**
 * The crown gap above the card (§2.6): one opening of sky-white light (`white` of the way from
 * the sky to the zone's light grade, times `gain`, at its centre; the sky at its rim) behind dark
 * lace, centred straight ahead at `elevation` degrees and `radius` times the lens's vertical
 * half-tangent across (so it is the same size on any screen), at full strength on an upright
 * screen and `landscape` of it on a wide one; its rim is ragged by the crowns' edges and the
 * lace's clusters.
 */
export const CROWN_GAP = Object.freeze({
    elevation: 42, radius: 0.26, soft: 0.5, landscape: 0.3, white: 0.6, gain: 1.2,
});

/**
 * The canopy where a view ray meets its plane (§4.4 item 3), seen through the air:
 *  - the crowns (bakeCrownMask, a 72 m tile of crowns 15–25 m across): their channels of crown
 *    shyness and the holes where three crowns meet, read through the crown layer's depth (a
 *    slanting ray crosses depth·cot(elevation) of leaves, so the mip widens with the slant and
 *    narrow channels close as the ray grazes: only big holes show near the horizon);
 *  - many small pinholes where leaf clusters part, and a few big holes (CANOPY_PIN, the crowns);
 *    every opening's rim crowded by darker leaf clusters and more of them hanging across it, its
 *    light brightest in its heart: never a flat cut-out;
 *  - where single leaves resolve, the leaf lace's two layers inside the crowns, and the leaves'
 *    edges glowing where the sky shines through them (backlit);
 *  - openings only toward the zenith (CANOPY_GAPS), a little wider just under the canopy (Crown
 *    Light's azure gaps), and the crown gap above the card (CROWN_GAP);
 *  - near, crown green over the zone's sky (the zenith deepening it at Crown Light); far, the
 *    crowns' dark cool mean (CANOPY_FAR).
 * The backdrop paints it above the horizon; a trunk dissolves into it where it enters the canopy.
 * A trunk dissolving into the canopy (`leaves: true`) melts into its leaves alone: the crowns' green
 * and dark mean with the lace's clumps, never the sky through an opening (mixed along the trunk's
 * ray, a gap would read as the bark turning transparent).
 * @param {object} u    the shared uniforms (with textures)
 * @param {object} dir  unit view direction (vec3 node)
 * @param {object} [pre]  the air's inscatter and vapour along dir, when the caller has them
 * @param {object} [options]
 * @param {boolean} [options.leaves]  the leaves only (no openings)
 */
export function rbCanopy(u, dir, pre = null, { leaves = false } = {}) {
    const upY = max(dir.y, 1e-3).toVar();
    const t = max(u.canopyY.sub(u.camPos.y), 1.0).div(upY).toVar();
    const at = u.camPos.add(dir.mul(t)).toVar();
    const sky = mix(u.col.sky, u.col.zenith, clamp(dir.y, 0.0, 1.0));
    if (!u.lace || !u.crowns) return rbAir(u, mix(sky, u.col.crown, CANOPY_COVER), at, pre, { billows: 0 });
    const q = at.xz.toVar();
    // The footprint of a pixel on the plane (metres, stretched by the slant).
    const foot = t.mul(u.pixelAngle).div(upY).toVar();
    // ── The crowns, through the crown layer's depth ──
    // A ray slanting through the layer crosses depth·cot(e) of it: read the crowns that much
    // softer, so their narrow channels close toward the horizon and only big holes stay.
    const crownTexel = CANOPY_CROWNS.tile / u.tex.crowns.image.width;
    const lodC = clamp(log2(foot.div(crownTexel)), 0.0, 8.0).toVar();
    const slant = sqrt(max(float(1.0).sub(upY.mul(upY)), 0.0)).div(upY).mul(CANOPY_CROWNS.depth);
    const stC = q.div(CANOPY_CROWNS.tile).add(vec2(0.21, 0.67)).toVar();
    const crown = u.crowns(stC, clamp(log2(max(foot, slant).div(crownTexel)), 0.0, 8.0)).toVar();
    // ── The leaves: a lace of twigs and leaves across the channels and holes, a few specks of sky
    // between the leaves inside a crown (the lace's own mip mean where single leaves do not
    // resolve: a soft mottle, never a speck) ──
    const size = u.tex.lace.image.width;
    const { tile, upper, turn } = CANOPY_LACE;
    // Half a mip softer than the footprint (a leaf a pixel or two across would only sparkle), and
    // up to half a mip more where the footprint is under a leaf (Crown Light: single leaves at
    // full contrast read as confetti).
    const fine = float(1.0).sub(smoothstep(0.08, 0.3, foot)).mul(0.5);
    const lod = clamp(log2(foot.div(tile / size)).add(0.5).add(fine), 0.0, 9.0).toVar();
    const nearK = float(1.0).sub(smoothstep(1.0, 2.5, lod)).toVar();
    const lower = u.lace(q.div(tile), lod).toVar();
    // ── Colour: near, crown green with backlit leaf edges; far, the crowns' dark cool mean ──
    // Beyond the first mips a partly covered texel is a blur of leaves and sky, not an edge (it
    // would glow as a net).
    const edge = mix(lower.mul(float(1.0).sub(lower)).mul(4.0), float(0.18), smoothstep(0.5, 1.75, lod)).mul(nearK);
    const backlit = u.col.crown.mul(BACKLIT_GAIN).add(vec3(...BACKLIT_WARM));
    const glow = rbHgMix(dot(dir, u.sunDir), float(0.75)).mul(1.5).add(1.0);
    const near = mix(u.col.crown, backlit, edge.mul(0.8)).mul(glow).toVar();
    const far = mix(u.col.hazeShade.mul(CANOPY_MEAN), u.col.crown, CANOPY_FAR_CROWN).toVar();
    const clumps = float(1.0 + CANOPY_CLUMPS).sub(lower.mul(2 * CANOPY_CLUMPS)).toVar();
    const farK = smoothstep(CANOPY_FAR[0], CANOPY_FAR[1], t).toVar();
    if (leaves) return rbAir(u, mix(near, far.mul(clumps), farK), at, pre, { billows: 0 });
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const turned = vec2(q.x.mul(c).sub(q.y.mul(s)), q.x.mul(s).add(q.y.mul(c))).div(upper).add(vec2(0.37, 0.61));
    // The upper layer a mip softer than its footprint: where the two layers' holes meet, the sky
    // shows as a soft opening, never as a sub-pixel speck at full strength.
    const higher = u.lace(turned, max(lod.sub(Math.log2(upper / tile) - 1.0), 0.0));
    const leafOpen = float(1.0).sub(lower).mul(float(1.0).sub(higher));
    // ── Openings: toward the zenith, wider just under the canopy ──
    // Where leaves resolve, the sky shows through the lace across the channels and holes (and as
    // a few specks inside a crown); farther, the pinholes and the crowns' few big holes (the
    // lace's mean there would mottle the whole canopy like a sea seen from below).
    const under = smoothstep(u.canopyY.sub(60.0), u.canopyY.sub(20.0), u.camPos.y);
    const shy = float(1.0).sub(crown).toVar();
    // A hole's rim is leaves, never a soft edge (a soft bright patch reads as a cloud): the
    // smooth hole is cut at a threshold ragged by a fine noise of leaf clusters (0.75–1.5 m).
    const ragTexel = CANOPY_RAG / u.tex.fbm.image.width;
    const ragN = u.fbmLod(q.div(CANOPY_RAG), clamp(log2(foot.div(ragTexel)), 0.0, 8.0)).toVar();
    // (And at the leaves' own scale, the lace at the footprint's mip: a rim ragged to the pixel.)
    const leafRag = float(0.5).sub(lower).mul(CANOPY_LEAF_RAG).toVar();
    const ragged = shy.add(ragN.b.mul(0.6).add(ragN.a.mul(0.4)).sub(0.5).mul(0.55)).add(leafRag).toVar();
    // Clearings come and go over a few hundred metres (the crowns again, a larger tile, turned
    // and read at a coarse mip), so the holes never fall in the crown tile's own lattice.
    const turnedC = vec2(q.x.mul(0.8).sub(q.y.mul(0.6)), q.x.mul(0.6).add(q.y.mul(0.8)));
    const clearing = u.crowns(turnedC.div(CANOPY_CROWNS.tile * 2.7).add(vec2(0.53, 0.19)), 6.0);
    // (Just under the canopy, Limb Storey and Crown Light, the gaps open lower: more sky lace.)
    const lowered = upY.add(under.mul(CANOPY_GAPS_UNDER));
    const gate = smoothstep(CANOPY_GAPS[0], CANOPY_GAPS[1], lowered).toVar();
    const shut = float(1.0).sub(gate).toVar();
    // (Below the first sine nothing opens at all: a short fade, not a line.)
    const floorGate = smoothstep(CANOPY_GAPS[0], CANOPY_GAPS[0] + 0.03, lowered);
    const cut = float(0.56).sub(under.mul(0.16)).add(clearing.sub(0.74).mul(CANOPY_CLEARING))
        .add(shut.mul(CANOPY_GAP_CUT.holes))
        .toVar();
    const holes = smoothstep(cut.sub(0.03), cut.add(0.03), ragged).toVar();
    // The pinholes, along the channels most.
    const pc = Math.cos(CANOPY_PIN.turn);
    const ps = Math.sin(CANOPY_PIN.turn);
    const qPin = vec2(q.x.mul(pc).sub(q.y.mul(ps)), q.x.mul(ps).add(q.y.mul(pc))).div(CANOPY_PIN.tile);
    const pinTexel = CANOPY_PIN.tile / u.tex.fbm.image.width;
    const pinN = u.fbmLod(qPin.add(vec2(0.71, 0.29)), clamp(log2(foot.div(pinTexel)), 0.0, 8.0));
    const pinV = pinN.a.mul(0.6).add(pinN.b.mul(0.4)).add(shy.mul(CANOPY_PIN.shy)).add(leafRag.mul(0.5));
    // (They gather in loose drifts: a broad band of the same noise moves their cut.)
    const pinCut = shut.mul(CANOPY_GAP_CUT.pins).add(CANOPY_PIN.cut)
        .add(float(0.5).sub(pinN.r).mul(CANOPY_PIN.cluster))
        .toVar();
    const pins = smoothstep(pinCut.sub(0.02), pinCut.add(0.01), pinV);
    // Leaf clusters crowd every opening's rim (a darker ring of leaves round each big hole) and
    // hang across it (the rag noise's finest band, 0.75 m clusters, half seen through).
    const rimmed = smoothstep(cut.sub(0.14), cut.sub(0.01), ragged).mul(float(1.0).sub(holes)).mul(floorGate);
    const across = mix(float(1.0 - CANOPY_SILHOUETTE), float(1.0), smoothstep(0.36, 0.5, ragN.a));
    const lacy = leafOpen.mul(mix(float(CANOPY_SPECKS), float(1.0), shy)).mul(under.mul(0.5).add(1.0));
    const open = mix(max(holes, pins).mul(floorGate).mul(across), min(lacy, 1.0).mul(gate), nearK).toVar();
    // Through an opening the light is brightest in its heart and dimmer at its leafy rim, never
    // a flat cut-out (where leaves resolve, the lace is the opening itself).
    const heartOf = smoothstep(0.0, 0.1, max(ragged.sub(cut), pinV.sub(pinCut)));
    const through = sky.mul(mix(heartOf.mul(0.35).add(0.8), float(1.0), nearK)).toVar();
    // ── The crown gap above the card: sky-white at its heart, its rim ragged by the crowns'
    // sharp edges and the lace's clusters ──
    const el = CROWN_GAP.elevation * DEG_TSL;
    const offset = dir.sub(vec3(0.0, Math.sin(el), -Math.cos(el)));
    // An irregular opening: its radius wanders with a broad noise round it (read at a fixed
    // level: the backdrop is branched, so no texture here may ask for derivatives).
    const lobes = u.fbmLod(offset.xz.div(u.tanHalf.y.mul(CROWN_GAP.radius * 3)).add(vec2(0.31, 0.77)), 3.0);
    const wander = lobes.r.mul(0.7).add(lobes.g.mul(0.3)).sub(0.5).mul(1.1)
        .add(1.0);
    const toward = length(offset).div(u.tanHalf.y.mul(CROWN_GAP.radius).mul(wander)).toVar();
    const crownEdge = u.crowns(stC, lodC);
    const field = float(1.0).sub(smoothstep(1.0 - CROWN_GAP.soft, 1.0, toward));
    const upright = float(1.0).sub(smoothstep(0.62, 1.5, u.tanHalf.x.div(u.tanHalf.y)));
    const strength = mix(float(CROWN_GAP.landscape), float(1.0), upright).toVar();
    const edges = field.add(float(0.5).sub(crownEdge).mul(0.5)).add(ragged.sub(shy))
        .add(float(0.5).sub(lower).mul(0.3));
    const gap = smoothstep(0.5, 0.56, edges).mul(strength);
    open.assign(max(open, gap));
    const white = mix(sky, u.col.gradeLight, CROWN_GAP.white).mul(CROWN_GAP.gain);
    const heart = float(1.0).sub(smoothstep(0.0, 1.0, toward)).mul(strength);
    through.assign(mix(through, white, heart.mul(heart)));
    // ── The leaves' colour (above), the far crowns' channels letting a little light through ──
    const seams = mix(far.mul(clumps), through, shy.mul(gate.mul(0.6).add(0.4)).mul(CANOPY_SEAMS));
    const leaf = mix(near, seams, farK)
        .mul(float(1.0).sub(rimmed.mul(CANOPY_RIM_DARK)));
    // From inside the mist its openings glow only as far as the vapour lets their light through
    // (scattered on the way: never crisp specks of sky through metres of mist), and the crowns
    // themselves fade into its glowing top as much again (the vapour overhead is lit from above:
    // from under it, the canopy is a shadow in the light, never a dark lid).
    const veiled = rbAirTransmittance2(u, at).y.toVar();
    const inside = rbMistInside(u).toVar();
    open.mulAssign(mix(float(1.0), veiled.mul(veiled), inside));
    const canopy = mix(leaf, through, open).toVar();
    const lost = pre ? mix(canopy, pre.vapour, inside.mul(float(1.0).sub(veiled))) : canopy;
    // (The canopy is never seen through the mist's top: from under the top it is the interior.)
    return rbAir(u, lost, at, pre, { billows: 0 });
}

/**
 * The painted bark (§4.2, as the bark notes amend it): ragged vertical ribbons of younger bark
 * (lime, emerald, ember, rust; rarely ruby, teal, cobalt, violet) in a cool slate matrix of old
 * bark with a few pale old-skin islands, lit by the sun, the sky and the mist's warm bounce, then
 * seen through the air.
 *
 *  1. Bark space: s around (atlas tiles; kRep a trunk), v up (14 m tiles).
 *  2. The atlas gives this texel's region, the one across its nearest edge and the signed edge
 *     distance. Where the texel's neighbours agree on the edge (ATLAS_CONSISTENT), the linear
 *     distance (torn along the grain on the fine draw) decides the side, and the pixel blends the
 *     two barks by how much of it each covers (analytic edge anti-aliasing); near a triple
 *     junction the nearest texel's region stands.
 *  3. Each patch's age runs on its group's clock (rbPatchAge); a patch that has just wrapped
 *     shows its fresh skin from the rim inward, and a patch about to shed lifts its lip. The
 *     matrix is old slate drifting between blue-, green- and purple-grey, maroon in places. A
 *     patch is older in its centre and fresher at its rim.
 *  4. Colour at the ambient chroma, a value jitter per patch, fresh bark flat satin; the matrix
 *     smooth weathered skin (broad value drift, faint mottling, a few flecks) with its islands
 *     paler; striation and rare fine cracks (detail tiers); hairline seams; where an old edge
 *     lifts (detail tiers), a lighter lip on the old side and its shadow line on the young.
 *  5. Fine detail fades to the group's mean colour as the pixel footprint grows (no confetti).
 *  6. Light: the sun (a broad placeholder for the canopy's light, neutral on old bark so the
 *     slate stays cool), sky fill (thinner below the eye, cooler over it), the mist's warm bounce
 *     (rbBounce: lifted below the eye on the shade side, dimmed above it) and the floor's warm
 *     glaze on the near satin below the eye (rbGlaze), a satin sheen toward grazing angles, and
 *     (fine) the sun's specular; down in the mist, the vapour's diffuse light instead (rbDrown),
 *     and up under the canopy its shade, then the crowns' leaves it dissolves into.
 *
 * @param {object} u     the shared uniforms (with textures)
 * @param {object} at    { P: world position, N: base normal (no flutes), bark: vec4 (s, v, θ, y),
 *                       inst: vec4 (code, group, seed, kRep), flute: vec2 (count, phase) }
 * @param {object} opts  { atlasSize, detail: striation and rim lift, fine: the torn edge and
 *                       the specular, canopyFade: metres below the canopy a trunk dissolves
 *                       into it over, billows: octaves of the mist top a foot sinks into }
 * @returns {object} vec3 node (scene-linear HDR, through the air)
 */
export function rbBark(u, at, {
    atlasSize = 512, detail = true, fine = true, canopyFade = CANOPY_SHADE, billows = 2,
} = {}) {
    const TW = BARK_TILE.around;
    // Interpolated coordinates are clamped (MSAA can extrapolate a varying past a strip's end).
    const kRep = floor(at.inst.w.add(0.5)).toVar();
    const s = clamp(at.bark.x, 0.0, kRep.add(1.0)).toVar();
    const v = clamp(at.bark.y, -64.0, 64.0).toVar();
    const theta = clamp(at.bark.z, 0.0, Math.PI * 2).toVar();
    const yM = clamp(at.bark.w, -20.0, 400.0).toVar();
    const group = floor(at.inst.y.add(0.5)).toVar();
    const seed = floor(at.inst.z.add(0.5)).toVar();
    const st = vec2(s, v);

    // ── 5. How much fine detail a pixel can hold (metres of bark per pixel) ──
    const footprint = max(fwidth(s).mul(TW), fwidth(yM)).toVar();
    const detailK = float(1.0).sub(smoothstep(0.05, 0.25, footprint)).toVar();

    // Coarse grain (2.4 m × 10 m tile): tint and value drift (r, 1.2 × 5 m; g, 0.6 × 2.5 m),
    // the reveal's ragged front (b, 15 × 60 cm), flecks (a).
    const coarseN = u.fbm(vec2(s.mul(2.0).add(seed.mul(0.37)), yM.div(10.0).add(seed.mul(0.21)))).toVar();
    // Fine grain (0.8 m × 4.8 m tile): tears, lip curl and mottling (b, 5 × 30 cm), fine cracks
    // (a, 2.5 × 15 cm). The tile divides the atlas's, so nothing seams where it repeats. Read
    // only where something uses it.
    const fineN = fine || detail ? u.fbm(vec2(s.mul(6.0), yM.div(4.8))).toVar() : null;

    // ── 2. The patch atlas ──
    const ids = u.atlasIds(st).toVar();
    const byte = (x) => floor(x.mul(255.0).add(0.5));
    const edgeOf = (g) => g.mul(255.0).sub(128.0).mul(PATCH_EDGE_RANGE / 127);
    const R = byte(ids.r).toVar();
    const B = byte(ids.b).toVar();
    const Araw = byte(ids.a);
    const agree = step(ATLAS_CONSISTENT - 0.5, Araw).toVar();
    const A = Araw.sub(agree.mul(ATLAS_CONSISTENT));
    const phiN = edgeOf(ids.g).toVar();
    const codeR = floor(A.add(0.5).div(9.0)).toVar();
    const codeB = A.sub(codeR.mul(9.0)).toVar();
    let phiL = edgeOf(u.atlasEdge(st).g).toVar();
    if (fine) {
        // The edge tears along the grain: the signed distance (one sense on both sides) is pushed
        // up to BARK_TEAR metres either way by the grain noise, fraying the outline into slivers.
        // Band-limited: where a pixel covers more than a few millimetres the tear fades, so its
        // islands never shrink below a pixel or two. Scaled by how steeply the distance runs per
        // metre of bark, so a pixel's tear is the same few centimetres on any edge.
        const tear = fineN.b.mul(0.85).add(fineN.a.mul(0.15)).sub(0.5);
        const tearK = float(1.0).sub(smoothstep(0.003, 0.007, footprint));
        const slopeK = clamp(fwidth(phiL).div(max(footprint, 1e-5)), 0.05, 1.0);
        phiL = phiL.add(tear.mul(2.0 * BARK_TEAR).mul(tearK).mul(slopeK)).toVar();
    }
    // No farther than a texel's diagonal (plus the tear) from an edge, and away from a junction,
    // the nearest texel knows the pair of regions; elsewhere its own region stands.
    const tau = Math.hypot(TW / atlasSize, BARK_TILE.up / atlasSize) + (fine ? BARK_TEAR : 0);
    const nearAny = step(abs(phiN), float(tau)).toVar();
    const nearEdge = nearAny.mul(agree).toVar();
    const side = mix(min(R, B), max(R, B), step(0.0, phiL));
    const region = floor(mix(R, side, nearEdge).add(0.5)).toVar();
    const swapped = step(0.5, abs(region.sub(R)));
    const other = mix(B, R, swapped).toVar();
    const cRegion = mix(codeR, codeB, swapped).toVar();
    const cOther = mix(codeB, codeR, swapped).toVar();
    // How much of the pixel the region covers: from ½ on the edge to 1 a pixel inside it. Near a
    // junction (no side flip) only a texel that sits on its edge blends toward the region across
    // it: a doubtful distance can soften the edge itself, never dot the patch beside it.
    const fwL = max(fwidth(phiL), 1e-5);
    const toward = step(other, region).mul(2.0).sub(1.0);
    const onEdge = step(abs(phiN), float(0.5 * Math.hypot(TW / atlasSize, BARK_TILE.up / atlasSize)));
    const blend = max(nearEdge, onEdge.mul(nearAny));
    const cover = mix(float(1.0), clamp(phiL.mul(toward).div(fwL).add(0.5), 0.0, 1.0), blend).toVar();
    // The distance to the edge (seams, lips, the older centre, a new skin's reveal): the linear
    // read wherever the neighbours agree on it, so it runs smoothly across texels.
    const dEdge = max(mix(abs(phiN), abs(phiL), agree), abs(phiN).sub(tau)).toVar();

    // ── 3. Ages ──
    // A patch that wraps over the tile seam belongs to the tile it is centred in.
    const tileOf = (code) => {
        const ds = floor(code.add(0.5).div(3.0));
        const dv = code.sub(ds.mul(3.0));
        return vec2(mod(floor(s).add(ds).sub(1.0).add(kRep), kRep), floor(v).add(dv).sub(1.0));
    };
    const pick4 = (q) => mix(mix(q.x, q.y, step(0.5, group)), mix(q.z, q.w, step(2.5, group)), step(1.5, group));
    const clock = pick4(u.groupClock).toVar();
    const bias = pick4(u.ageBias).toVar();
    const cycle = vec2(pick4(vec4(...GROUP_CYCLE.lifeScale)), pick4(vec4(...GROUP_CYCLE.share))).toVar();
    const tR = tileOf(cRegion).toVar();
    const tO = tileOf(cOther).toVar();
    const lifeR = rbPatchAge(vec3(region, tR.x, tR.y), seed, clock, bias, cycle).toVar();
    const lifeO = rbPatchAge(vec3(other, tO.x, tO.y), seed, clock, bias, cycle).toVar();
    const patchR = step(ATLAS_ISLANDS + 0.5, region).toVar();
    const patchO = step(ATLAS_ISLANDS + 0.5, other).toVar();
    const islandR = step(0.5, region).sub(patchR).toVar();
    const islandO = step(0.5, other).sub(patchO).toVar();
    // The matrix: old slate wandering a little, weathered toward maroon in places; its islands a
    // touch older (their lips lift over it).
    const matrixAge = float(MATRIX_AGE).add(coarseN.r.sub(0.5).mul(0.06))
        .sub(smoothstep(0.66, 0.86, coarseN.g).mul(0.075)).toVar();
    // Just wrapped: the old skin still covers the patch, and the fresh one shows from the rim
    // inward along a ragged front. The two are blended as colours (below), never through the
    // ramp between them; the lips go on as the old skin's until it has gone.
    const lastAge = AGE_PHASE_STOPS[AGE_PHASE_STOPS.length - 1][1];
    const front = clamp(lifeR.y.div(PATCH_REVEAL), 0.0, 1.0).mul(PATCH_EDGE_RANGE + 0.16);
    const ragged = dEdge.add(coarseN.b.mul(0.14).mul(smoothstep(0.0, 0.05, dEdge)));
    const shown = mix(float(1.0), float(1.0).sub(smoothstep(front.sub(0.012), front, ragged)), patchR).toVar();
    const aR = mix(matrixAge.add(islandR.mul(0.01)), lifeR.x, patchR).toVar();
    const aO = mix(matrixAge.add(islandO.mul(0.01)), lifeO.x, patchO).toVar();

    // Inside a patch: older toward its centre (a smooth gradient off the rim, nothing noisy:
    // between ember and rust a small step of age is a large step of value, and past the rust a
    // maroon rim round a slate centre would read as a stain, so the gradient fades there).
    const inner = smoothstep(0.0, 0.2, dEdge).mul(mix(0.03, 0.006, smoothstep(0.78, 0.86, aR)));
    const aLoc = clamp(aR.add(patchR.mul(inner)), 0.0, 1.0).toVar();
    // The skin a pixel shows: the new one where it has been revealed, else the old (its
    // weathering, its light and its lips follow it, so nothing jumps at the wrap).
    const aSkin = mix(float(lastAge), aLoc, shown).toVar();

    // ── 4. Colour ──
    // The ambient bark at an age (barkAlbedo's twin): the ambient chroma, fresh bark dimmed, the
    // rare accents muted and a little darker.
    const { from: accentFrom, to: accentTo, ramp: accentRamp } = BARK_ACCENT;
    const barkOf = (age) => {
        const c = u.ramp(age);
        const accent = smoothstep(accentFrom - accentRamp, accentFrom, age)
            .sub(smoothstep(accentTo, accentTo + accentRamp, age));
        const fresh = float(1.0).sub(smoothstep(BARK_FRESH_DIM.from, BARK_FRESH_DIM.to, age))
            .mul(BARK_FRESH_DIM.k - 1).add(1.0);
        const k = fresh.mul(accent.mul(BARK_ACCENT.dim - 1).add(1.0)).mul(BARK_ALBEDO);
        return mix(vec3(rbLuma(c)), c, float(BARK_CHROMA).sub(accent.mul(BARK_ACCENT.mute))).mul(k);
    };
    // Old slate drifts in hue between blue-, green- and purple-grey (coarse r and g).
    const t1 = coarseN.r.sub(0.5).mul(2.0);
    const t2 = coarseN.g.sub(0.5).mul(2.0);
    const tint = vec3(
        t1.mul(0.08).add(1.0),
        t2.mul(0.05).sub(t1.mul(0.03)).add(1.0),
        float(1.0).sub(t1.mul(0.09)).sub(t2.mul(0.03)).add(0.03),
    ).toVar();
    const hashOf = (id, tile) => {
        const at3 = vec3(id.add(seed.mul(0.173)), tile.x.mul(1.37).add(3.1), tile.y.mul(0.71).add(9.7));
        return rbHash31(at3);
    };
    // Neighbouring patches differ in value as much as in hue; the islands are paler.
    const valueOf = (patch, island, h) => patch.mul(h.sub(0.5).mul(0.3)).add(island.mul(ISLAND_LIFT)).add(1.0);
    // Weathering belongs to the slate (past the maroon): ember and rust stay clean and warm.
    const oldOf = (age) => smoothstep(0.86, 0.95, age);
    // The matrix wears it fully; an old patch only faintly (it has not been out as long): broad
    // soft tonal zones over metres, a few small pale flecks, faint mottling.
    const drift = coarseN.g.sub(0.5).mul(0.3).add(coarseN.r.sub(0.5).mul(0.14));
    const flecks = smoothstep(0.86, 0.93, coarseN.a).mul(0.12);
    const weathered = (oldK, patch) => {
        const w = oldK.mul(patch.mul(-0.65).add(1.0));
        return mix(vec3(1.0), tint, oldK).mul(drift.add(flecks).mul(w).add(1.0));
    };
    const valueR = valueOf(patchR, islandR, hashOf(region, tR)).toVar();
    const col = mix(vec3(...barkAlbedo(lastAge)), barkOf(aLoc), shown).mul(valueR).toVar();
    const old = oldOf(aSkin).toVar();
    const worn = old.mul(patchR.mul(-0.65).add(1.0)).toVar();
    col.mulAssign(weathered(old, patchR));
    if (fineN) col.mulAssign(fineN.b.sub(0.5).mul(worn.mul(0.08)).add(1.0));
    // A patch is a little fresher toward one end (a soft gradient along it).
    col.mulAssign(patchR.mul(coarseN.r.sub(0.5).mul(0.1)).add(1.0));
    if (detail) {
        // Striation: fine, faint and long (8 and 4 mm × 30 and 15 cm, filtered through its mips),
        // and in old bark a few fine cracks, which only close views draw (narrower than a pixel
        // they would only twinkle).
        const grain = u.fbm(vec2(s.mul(18.0), yM.div(9.6))).a;
        const crackW = max(fwidth(fineN.a), 0.004);
        const crackK = worn.mul(float(1.0).sub(smoothstep(0.004, 0.01, footprint)));
        const crackDark = float(1.0).sub(smoothstep(crackW.negate().add(0.06), crackW.add(0.06), fineN.a));
        const crackPale = smoothstep(crackW.negate().add(0.92), crackW.add(0.92), fineN.a);
        const lines = grain.sub(0.5).mul(old.mul(0.06).add(0.12))
            .add(crackPale.mul(0.08).sub(crackDark.mul(0.22)).mul(crackK));
        col.mulAssign(lines.mul(detailK).add(1.0));
    }
    // The bark across the edge, cheaply (its age, value and weathering): the pixel's other share.
    const colO = barkOf(aO).mul(valueOf(patchO, islandO, hashOf(other, tO))).mul(weathered(oldOf(aO), patchO));
    col.assign(mix(colO, col, cover));
    // A hairline seam on every edge.
    const fw = fwidth(dEdge).toVar();
    const seamW = 0.0025;
    const seam = rbBand(dEdge, float(seamW), fw).toVar();
    col.mulAssign(float(1.0).sub(seam.mul(0.5).mul(detailK)));
    if (detail) {
        // The older side of an edge lifts: its lip catches the light, and its shadow falls on the
        // younger bark as a dark line that deepens to a crack where the lip has curled furthest.
        // A patch about to shed lifts all the way over its last seconds.
        const older = step(aO, aSkin);
        const curl = fineN.b.toVar();
        const build = clamp(float(1.0).sub(min(lifeR.z, lifeO.z).div(PATCH_BUILD)), 0.0, 1.0);
        const lift = max(smoothstep(0.8, 0.97, max(aSkin, aO)).mul(curl.mul(0.6).add(0.4)), build).toVar();
        const lip = rbBand(dEdge, lift.mul(0.008).add(0.005 + seamW), fw).sub(seam).mul(older).mul(lift);
        col.mulAssign(lip.mul(0.5).mul(detailK).add(1.0));
        const reach = lift.mul(0.02).add(0.008);
        const shadow = float(1.0).sub(smoothstep(0.0, reach, dEdge.sub(seamW)))
            .mul(float(1.0).sub(older)).mul(lift);
        const depth = smoothstep(0.6, 0.9, curl).mul(0.35).add(0.45);
        col.mulAssign(float(1.0).sub(shadow.mul(depth).mul(detailK)));
    }
    const mean = u.palette.element(int(group).add(PALETTE_ROWS.groupMean)).xyz;
    const albedo = mix(mean, col, detailK).toVar();

    // ── 6. Light ──
    const { P } = at;
    // The flutes tilt the normal round the trunk (∂r/∂θ over r); a slow irregular bulge too.
    const around = vec3(sin(theta).negate(), 0.0, cos(theta));
    const fluteArg = at.flute.x.mul(theta).add(at.flute.y).add(yM.mul(TRUNK_FLUTE.twist));
    const slope = sin(fluteArg).mul(at.flute.x).mul(-TRUNK_FLUTE.amp).add(coarseN.g.sub(0.5).mul(0.12));
    const N = normalize(at.N.sub(around.mul(slope))).toVar();
    const V = normalize(cameraPosition.sub(P)).toVar();
    const L = u.sunDir;
    const ndl = max(dot(N, L), 0.0).toVar();
    // Placeholder for the canopy's light (the gobo comes with the flecks): broad soft pools
    // where the sun gets through, where the sun ray crosses the canopy plane (no texture read).
    const toCanopy = max(u.canopyY.sub(P.y), 0.0).div(max(L.y, 0.2));
    const q = P.xz.add(L.xz.mul(toCanopy)).div(9.0).toVar();
    const pools = sin(q.x.mul(1.1).add(sin(q.y.mul(0.7))).add(1.3))
        .add(sin(q.y.mul(0.9).add(sin(q.x.mul(0.6))).sub(0.6)));
    const fl = smoothstep(0.1, 0.9, pools.mul(0.25).add(0.5)).mul(0.35).add(0.65).toVar();
    // Old bark takes the sun nearly white, so the lit slate stays cool in the blue air.
    const sun = mix(u.sunCol, vec3(rbLuma(u.sunCol)), old.mul(0.7)).toVar();
    const direct = sun.mul(fl.mul(ndl));
    // Fill: the sky through the canopy from above (cool), and the bright forward-scattering haze
    // on the sun's side (warm), so the bole shades smoothly round from the light to the blue.
    // (Below the eye the sky's cool fill thins, SKY_FILL_LOW, and the mist's warm bounce beats it.)
    const ao = smoothstep(0.0, 0.05, dEdge).mul(0.15).add(0.85);
    const sunSide = dot(N.xz, normalize(L.xz)).mul(0.5).add(0.5).toVar();
    const skyFill = u.col.sky.mul(N.y.mul(0.2).add(0.24)).mul(rbSkyFill(u, P.y));
    const ambient = skyFill.add(u.col.hazeSun.mul(sunSide.mul(0.14))).mul(ao);
    // Bounce (§2.4): warm light up from the mist top, fading with height above it, strongest on
    // bark that faces down toward it, and (BOUNCE) on the shade side below the eye.
    const facing = max(float(0.3).sub(N.y), 0.0).mul(0.55).add(0.45);
    const away = float(1.0).sub(smoothstep(0.3, 0.7, sunSide));
    const bounce = rbBounce(u, P.y, facing, away);
    const rough = mix(0.25, 0.75, smoothstep(0.1, 0.9, aSkin)).toVar();
    // (The cosine is held off zero: on a coarse grid the interpolated normal grazes at the very
    // silhouette before the facet does, and an unbounded Fresnel there dots the outline with sky.)
    const F = rbSchlick(max(dot(N, V), 0.15), float(0.04)).toVar();
    // The sheen: the blue air, warming toward the sun, in a satin strip toward the silhouette; a
    // reflection that looks down sees the mist's luminous top instead (the wet bark below the eye
    // carries the floor's warm glow up its edges).
    const Rv = reflect(V.negate(), N).toVar();
    const air = mix(u.col.hazeShade, u.col.hazeSun, clamp(dot(Rv, L).mul(0.5).add(0.5), 0.0, 1.0));
    const floorGlow = mix(u.col.mistTop, u.col.underglow, 0.5).mul(SHEEN_FLOOR);
    const sky = mix(air, floorGlow, smoothstep(0.0, -0.45, Rv.y).mul(float(1.0).sub(rbMistInside(u))));
    const sheen = sky.mul(F.mul(u.sheenK).mul(float(1.0).sub(rough)));
    // (The floor's glaze is the near satin's: on a far trunk, a pixel of mean bark, it fades.)
    const glaze = rbGlaze(u, P.y, away).mul(detailK.mul(0.75).add(0.25));
    const lit = albedo.mul(direct.add(ambient).add(bounce)).add(sheen).add(glaze).toVar();
    if (fine) {
        const H = normalize(L.add(V));
        const ndh = max(dot(N, H), 0.0);
        const a2 = rough.mul(rough).mul(rough).mul(rough);
        const dd = ndh.mul(ndh).mul(a2.sub(1.0)).add(1.0);
        const D = a2.div(dd.mul(dd).mul(Math.PI).add(1e-4));
        lit.addAssign(sun.mul(fl.mul(ndl).mul(D).mul(F).mul(0.25)));
    }
    // Down in the mist it has lost its sun, its sky and its bounce to the vapour's light (rbDrown).
    lit.assign(mix(lit, albedo.mul(u.col.mistTop).mul(MIST_DROWN_LIGHT), rbDrown(u, P.y)));
    // Up under the canopy the bark stands in the crowns' shade…
    lit.mulAssign(float(1.0).sub(smoothstep(u.canopyY.sub(canopyFade * 2), u.canopyY, P.y).mul(0.5)));
    const seen = rbAir(u, lit, P, null, { billows }).toVar();
    if (u.lace) {
        // …and over its last metres it dissolves into the canopy the backdrop paints along this very
        // ray, so a trunk or a limb enters the lace (where its tube ends) without a line.
        const into = smoothstep(u.canopyY.sub(canopyFade), u.canopyY.sub(0.5), P.y).toVar();
        const ray = P.sub(cameraPosition).normalize().toVar();
        If(into.greaterThan(0.001), () => {
            seen.assign(mix(seen, rbCanopy(u, ray, null, { leaves: true }), into));
        });
    }
    return seen;
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

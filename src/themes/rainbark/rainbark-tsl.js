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
    Loop,
    abs,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    exp,
    exp2,
    float,
    floor,
    fract,
    fwidth,
    int,
    inversesqrt,
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
    FLECK,
    GAP_MASK,
    GROUP_CYCLE,
    ISLAND_LIFT,
    LATTICE_SLICE,
    MATRIX_AGE,
    PATCH_BUILD,
    PATCH_EDGE_RANGE,
    PATCH_LIFE,
    PATCH_REVEAL,
    PALETTE_ROWS,
    TIDE_LIGHT,
    TRUNK_FLUTE,
    PIECE_AGE,
    ZONES,
    ZONE_COLOR_KEYS,
    barkAlbedo,
    buildMips,
    climbHeight,
    fleckLodAt,
    hexToLinear,
    mistGrainAt,
    rampAt,
    ribbonPhases,
    sunDirection,
    tideAt,
} from './rainbark-core.js';

export * from './rainbark-core.js';

const DEG_TSL = Math.PI / 180;
const TAU_TSL = Math.PI * 2;

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
 * a path to white for what the sun burns (FILMIC_WHITE: from a peak of `from` to `to`, at most
 * `most` of the way), so the bark keeps its colour in shade and haze, and a fleck on a jewel
 * patch glows toward white-gold the way sunlit colour does, never a flat full-chroma fill.
 */
export const FILMIC_WHITE = Object.freeze({ from: 2.0, to: 9, most: 0.45 });
export const rbFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(rbMax3(c), 1e-5);
    const k = float(0.48);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    const white = smoothstep(FILMIC_WHITE.from, FILMIC_WHITE.to, peak).mul(FILMIC_WHITE.most);
    return mix(toned, vec3(mapped, mapped, mapped), white);
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
 * `cycle` = (its group's life scale, the share of the group's patches that cycle), `place` the
 * ribbon's place in its tile's cycle (ribbonPhases: spread by area, so every tile shows the
 * designed mix of ages by area at every moment, never two big ribbons in one narrow band).
 * The ribbons of one tile share a life ((240–600 s) × scale, hashed per tile) and turn round it
 * from their places, offset per tile. Each runs on its group's clock, warped by its group's age
 * bias; a ribbon that does not cycle holds its place (and reports a wrap long ago and long ahead).
 */
export const rbPatchAge = /* @__PURE__ */ Fn(([cell, salt, clock, bias, cycle, place]) => {
    const home = vec3(cell.y.mul(1.31).add(salt.mul(0.731)), cell.z.mul(0.77).add(salt.mul(0.113)), 3.7);
    const tile = rbHash31(home).toVar();
    const own = rbHash31(cell.zxy.add(vec3(17.13, salt.mul(0.377), 5.29)));
    const life = tile.mul(PATCH_LIFE.span).add(PATCH_LIFE.min).mul(cycle.x).toVar();
    const cycles = step(own, cycle.y);
    const start = fract(place.add(fract(tile.mul(97.31))));
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
        { name: 'place', type: 'float' },
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

/**
 * Write a zone's colour set (sRGB hexes) into the palette rows, as linear rgb; the shade haze's row
 * carries the zone's `pearl` in w (u.pearl), every other row 1.
 */
export function writeZoneColors(table, colors, pearl = 0) {
    const rgb = [0, 0, 0];
    ZONE_COLOR_KEYS.forEach((key) => {
        hexToLinear(colors[key], rgb);
        table[PALETTE_ROWS[key]].set(rgb[0], rgb[1], rgb[2], key === 'hazeShade' ? pearl : 1);
    });
}

/** Write the ribbons' places in their cycle (ribbonPhases) into the palette's phase rows. */
export function writeRibbonPhases(table, phases) {
    for (let r = 0; r < Math.ceil(ATLAS_RIBBONS / 4); r++) {
        const at = (i) => (r * 4 + i < phases.length ? phases[r * 4 + i] : 0);
        table[PALETTE_ROWS.phases + r].set(at(0), at(1), at(2), at(3));
    }
}

/**
 * The sun's light at the Bole (scene-linear): SUN_WHITE of it white, the rest the zone's fleck
 * colour (Fleck Gold at the Bole); other zones tint it by their own fleck colour. Bright enough
 * that a fleck stands four stops over the shade beside it and blooms (§2.4): the bark that faces
 * the sun most squarely (N·L 0.57) takes about 7.4 in a fleck's heart, the spec's
 * (4.2, 3.7, 2.9) roughly at the soft rim's half-light (a deviation from §4.2 recorded in the
 * spec). Little of it is white, so a fleck on the slate lands near Fleck Gold and on a jewel
 * patch stays saturated.
 */
export const SUN_WHITE = 0.1;
export const SUN_BOLE = Object.freeze([13, 10.29, 5.41]);

/**
 * Every uniform the scene's materials share, set for the Bole zone on level 4. The world owns
 * the values; materials only read. `textures` (createBarkTextures) adds the samplers.
 */
export function createRainbarkUniforms(textures = null) {
    const zone = ZONES[1];
    const palette = rows(PALETTE_ROWS.total);
    const events = rows(EVENT_ROWS.total);
    writeZoneColors(palette, zone.colors, zone.pearl);
    const rgb = [0, 0, 0];
    // The group means start as old bark; the piece-age rows hold the bark at each piece's age.
    rampAt(0.86, rgb);
    for (let g = 0; g < 4; g++) palette[PALETTE_ROWS.groupMean + g].set(rgb[0], rgb[1], rgb[2], 0.86);
    PIECE_AGE.forEach((age, code) => {
        rampAt(age, rgb);
        palette[PALETTE_ROWS.pieceAge + code].set(rgb[0], rgb[1], rgb[2], age);
    });
    // The ribbons' places in their cycle: evenly spread until the atlas's own (by area) arrive.
    writeRibbonPhases(palette, ribbonPhases(new Float32Array(ATLAS_RIBBONS).fill(1)));
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
        /** The zone's exposure (the post's): what a light must stand under to land where it means. */
        exposure: uniform(zone.exposure),
        /**
         * The mist top's billow contrast (billowContrast: 0 while the Climb swaps the billows'
         * grain at its midpoint, so the swap happens while the floor is flat).
         */
        billowK: uniform(1),
        /** The sun's light (scene-linear), and the sheen's strength over the tide (0.6 … 1.0). */
        sunCol: uniform(new THREE.Vector3(SUN_BOLE[0], SUN_BOLE[1], SUN_BOLE[2])),
        sheenK: uniform(0.8),
        /**
         * The canopy's gobo (rbFleck): its wind (tiles of the gap mask: canopyWind), the zone's
         * threshold (fleckThreshold), the flecks' light over the tide clock (and none under
         * Mistfall), and the one level Low and Minimal read the mask at (the eye's: fleckLodAt);
         * `fleckMean` is the flecks' mean light (fleckThreshold), which far bark melts into.
         */
        wind: uniform(new THREE.Vector2(0, 0)),
        fleckThr: uniform(1),
        fleckMean: uniform(0.2),
        fleckLight: uniform(1),
        fleckLod: uniform(fleckLodAt(camY, sun[1])),
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
    /** How pearly the zone is (ZONES[i].pearl, crossfaded: 1 in the Fog Line and under Mistfall). */
    u.pearl = u.palette.element(PALETTE_ROWS.hazeShade).w;
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
        /**
         * The canopy's crown field at a mip level (bakeCrownField: vec4 of the signed distance to
         * the leaves' edge, the limbs, the openings' half-width and the masses' tone, all 0 … 1).
         */
        if (textures.crowns) u.crowns = (st, lod) => texture(textures.crowns, st).level(lod);
        /** The canopy's gap mask (0 leaves … 1 open) at a level of its Gaussian pyramid. */
        if (textures.gap) u.gap = (st, lod) => texture(textures.gap, st).level(lod).r;
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
    atlas, ramp, fbm, lattice, lace = null, crowns = null, gap = null,
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
            name: 'rainbark-crowns', filter: 'mipmap', channels: crowns.channels || 1, mipmaps: crowns.mipmaps,
        });
    }
    if (gap) {
        textures.gap = createRainbarkTexture(gap.data, gap.size, gap.size, {
            name: 'rainbark-gaps', filter: 'mipmap', channels: 1, mipmaps: gap.mipmaps,
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

/**
 * How much darker the haze grows looking up toward the canopy's shade (from 6° up, full at 37°;
 * half of it in a pearly zone, where the vapour overhead is lit): the top of the frame is its
 * darkest broad band, the value anchor the luminous air below is read against.
 */
export const HAZE_UPWARD_DIM = 0.6;
/**
 * The sunlit side of the air: looking toward the sun's azimuth (however high it stands) the haze
 * warms and brightens broadly, from a cosine of `from` to the sun's azimuth to full at `to`, up to
 * `k` of the way to the sunlit vapour at the horizon and `lift` brighter than it, so the open right
 * of the frame (the aisle behind the HUD) is the brightest broad area, cream toward the sun, and
 * the shade on the left stays blue-violet: the light enters from the open right (§2.1, §2.4). The
 * way from the blue to the cream runs round through a lavender-rose (their mean times `rose`,
 * channel gains), as a sky's does, never through grey; and toward the sun it turns cream (`warm`,
 * channel gains, as the sun side fills in), never a neutral pale.
 */
export const HAZE_SUN_SIDE = Object.freeze({
    from: 0.1,
    to: 0.68,
    k: 1.0,
    lift: 0.0,
    rose: Object.freeze([1.12, 0.94, 1.0]),
    warm: Object.freeze([1.08, 1.0, 0.72]),
});
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
 * frame (the mist nearer at every angle) and strengthens; as it drains it sinks and fades. (§4.4
 * adds 0.35 of the underglow from 27° down whatever the mist does; through the blue haze that
 * reads lavender, or grey, over the mist, never the cream vapour of §2.1.)
 */
export const HAZE_UNDERGLOW = Object.freeze({
    near: 71, far: 150, ref: 25, least: 6, mix: 0.7, floor: 1.35, most: 0.95, add: 0.05, tide: 17,
});
/**
 * The air's light never stands over `peak` (scene-linear, its brightest channel, before the
 * exposure), rolled off softly from `knee`: the luminous air stays under the bloom's knee, which
 * belongs to the flecks, the sheen and the haze's one luminous core (HAZE_CORE, which raises the
 * cap round it); a broad field of air blooming would wash the open right to a flat pale cream.
 */
export const HAZE_PEAK = Object.freeze({ knee: 0.54, peak: 0.74 });
/**
 * The gold of the sunlit air (a deliberate departure from the spec's low-chroma Sunlit Vapour,
 * recorded in its §4.4: the A4b review measured the open right at a chroma of 12 against the
 * sunset theme's 38, an overcast pastel). Toward the sun's azimuth (its cosine from `from` to
 * `to`, about 70° to 25° off it: the aisle behind the HUD and the right edge of the frame) the haze
 * turns up to `k` of the way to the sun's own gold (the zone's fleck hue at `chroma` times its
 * chroma, at the haze's lightness: about #F4D9A0 at the Bole), most near the horizon (gone by a
 * slope of `low[1]`, full under `low[0]`),
 * so warm on cool reads as a real split: Terpene Haze blue on the left, gold on the right; the low
 * air's glow off the mist (HAZE_UNDERGLOW) turns `glow` of the way there on the same side. Only in
 * a zone whose sunlit haze is warm (its red's lead over its blue, as a share of its blue, from
 * `warmth[0]` to `warmth[1]`: the Bole, the Limb Storey, most of Crown Light; never Buttress Deep's
 * cool storey nor the Fog Line's pearl).
 */
export const HAZE_GOLD = Object.freeze({
    from: 0.3,
    to: 0.9,
    k: 1.0,
    chroma: 1.3,
    glow: 0.5,
    low: Object.freeze([0.05, 0.5]),
    warmth: Object.freeze([0.1, 0.45]),
});
/**
 * The picture's light source: one luminous core in the gold air, `azimuth` degrees right of the
 * view axis (between the aisle behind the HUD and Sister One, toward the sun's side) and
 * `elevation` degrees up, `across` radians wide (the first toward the card, the second toward the
 * sun) and `up` (a sine) tall (Gaussian), where the haze brightens by up to `gain` and turns
 * `gold` further toward the sun's gold, its cap raised to
 * `peak` (so the bloom catches it: the trunks before it stand dark against light). As warm as the
 * zone's sunlit haze (HAZE_GOLD.warmth); in a pearly zone, `pearl` of it.
 */
export const HAZE_CORE = Object.freeze({
    azimuth: 24,
    elevation: 8,
    across: Object.freeze([0.2, 0.42]),
    up: 0.18,
    gain: 1.45,
    gold: 0.7,
    peak: 1.7,
    pearl: 0.3,
});
/**
 * The shade side of the air (looking away from the sun's azimuth: its cosine from `from` up to
 * `to`) darkens further upward (`dim` more of HAZE_UPWARD_DIM's ramp) and leans `indigo` of the
 * way to the zone's deepest shade hue (Understory Indigo at the Bole): the light enters from the
 * gold right, read against a dark upper left.
 */
export const HAZE_SHADE = Object.freeze({
    from: 0.4, to: -0.3, dim: 0.35, indigo: 0.35,
});

/**
 * A colour rolled off softly under `peak` on its brightest channel from `knee` (hue preserving):
 * what a broad field of light (the air, the mist's top) never stands over. `peak` may be a node.
 */
export function rbRollOff(col, { knee, peak }) {
    const m = max(rbMax3(col), 1e-5).toVar();
    const roll = float(peak).sub(knee);
    const over = max(m.sub(knee), 0.0).div(roll.negate());
    const rolled = float(knee).add(roll.mul(float(1.0).sub(exp(over))));
    return col.mul(min(m, rolled).div(m));
}

/** How far the camera stands inside the mist (0 above its top … 1 a couple of metres under it). */
export const rbMistInside = (u) => smoothstep(-2.0, 2.0, u.tide.sub(u.camPos.y));

/**
 * Breaking out on top of the mist (the Fog Line's c = 7, any storey whose eye stands within
 * `eye[0]`–`eye[1]` metres over the tide): the top would run out to the horizon as an open sea of
 * cloud (§9 #4) and meet the haze in a line. There the vapour toward the horizon melts into the
 * haze itself: fully from a ray `fade[0]` (sine of its depression: 3°) under the horizon, none from
 * `fade[1]` (14°; from an eye under `low.eye[1]` metres over the top, down to `low.eye[0]`, none
 * from `low.fade`, 24°): the mist's top shows only below and between the trunks, the luminous haze
 * running on down through the far band with the grove standing in it, and from just over the top
 * the floor is vapour round the trunks' feet, never a ground plane. The haze is brighter than
 * anything in it: the top's light never stands over `cap` of the haze's along the same ray (rolled
 * off under it), the low air's glow off the near mist (HAZE_UNDERGLOW) keeps only 1 − `glow` of
 * itself (none: there the low air is the haze), and the billows' slopes are read over `soften` times the range (MIST_BILLOWS), so their
 * lees are diffuse shade in the vapour, never crisp blotches on a snowfield.
 */
export const MIST_BREAKOUT = Object.freeze({
    eye: Object.freeze([8, 18]),
    fade: Object.freeze([0.05, 0.24]),
    low: Object.freeze({ fade: 0.41, eye: Object.freeze([6, 12]) }),
    cap: 0.75,
    soften: 2.5,
    glow: 1.0,
});
/** How near the eye is to breaking out on top of the mist (MIST_BREAKOUT: 0 well over it … 1 at it). */
export const rbBreakout = (u) => float(1.0)
    .sub(smoothstep(MIST_BREAKOUT.eye[0], MIST_BREAKOUT.eye[1], u.camPos.y.sub(u.tide)))
    .mul(float(1.0).sub(rbMistInside(u)));

/**
 * The light the air scatters toward the eye along a direction (§4.4): blue-violet shade, warming
 * to sunlit vapour toward the sun (Henyey–Greenstein forward scatter, and broadly on the sun's side
 * of the sky), and the mist's glow on rays that look down and meet it near (HAZE_UNDERGLOW).
 */
export function rbInscatter(u, dir) {
    const G = HAZE_UNDERGLOW;
    const toward = rbHgMix(dot(dir, u.sunDir), float(0.55));
    const flat = dir.xz.div(max(length(dir.xz), 1e-3)).toVar();
    const sunFlat = normalize(u.sunDir.xz).toVar();
    const cosAz = dot(flat, sunFlat).toVar();
    const side = smoothstep(HAZE_SUN_SIDE.from, HAZE_SUN_SIDE.to, cosAz).mul(float(1.0).sub(abs(dir.y))).toVar();
    const span = max(u.camPos.y.sub(mix(u.hazeY, u.tide, 0.5)), G.least).div(G.ref).toVar();
    // (From an eye at the mist's top, as from one `least` metres over it: the glow keeps to the
    // bottom of the frame, never switching on a degree under the horizon in a line.)
    const toMist = max(u.camPos.y.sub(u.tide), G.least).div(max(dir.y.negate(), 1e-3));
    const down = float(1.0).sub(smoothstep(span.mul(G.near), span.mul(G.far), toMist)).toVar();
    // A touch darker upward, toward the canopy's shade (every part's air agrees with the backdrop),
    // and darker still and indigo on the shade side (HAZE_SHADE).
    const rising = smoothstep(0.1, 0.6, dir.y).toVar();
    const shadeSide = smoothstep(HAZE_SHADE.from, HAZE_SHADE.to, cosAz).mul(rising).toVar();
    const up = rising.mul(HAZE_UPWARD_DIM).mul(float(1.0).sub(u.pearl.mul(0.5)))
        .add(shadeSide.mul(HAZE_SHADE.dim));
    const base = mix(u.col.hazeShade, u.col.hazeSun, toward).toVar();
    const sunAir = u.col.hazeSun.mul(side.mul(HAZE_SUN_SIDE.lift).add(1.0)).toVar();
    const rose = mix(base, sunAir, 0.5).mul(vec3(...HAZE_SUN_SIDE.rose)).toVar();
    const w = side.mul(HAZE_SUN_SIDE.k).toVar();
    const cream = mix(mix(base, rose, w), mix(rose, sunAir, w), w).mul(mix(vec3(1.0), vec3(...HAZE_SUN_SIDE.warm), w))
        .toVar();
    // The sunlit air's gold (HAZE_GOLD), as warm as the zone's sunlit haze, and its one luminous
    // core (HAZE_CORE).
    const hs = u.col.hazeSun;
    const warmth = smoothstep(HAZE_GOLD.warmth[0], HAZE_GOLD.warmth[1], hs.x.sub(hs.z).div(max(hs.z, 1e-3))).toVar();
    const fleckHue = u.col.fleck.div(max(rbLuma(u.col.fleck), 1e-4));
    const goldHue = max(fleckHue.sub(1.0).mul(HAZE_GOLD.chroma).add(1.0), vec3(0.0)).toVar();
    const low = float(1.0).sub(smoothstep(HAZE_GOLD.low[0], HAZE_GOLD.low[1], abs(dir.y)));
    const sunward = smoothstep(HAZE_GOLD.from, HAZE_GOLD.to, cosAz).mul(warmth).toVar();
    const goldK = sunward.mul(low).mul(HAZE_GOLD.k);
    const golden = mix(cream, goldHue.mul(rbLuma(cream)), goldK).toVar();
    const coreAz = HAZE_CORE.azimuth * DEG_TSL;
    const coreFlat = vec2(Math.sin(coreAz), -Math.cos(coreAz));
    const offUp = dir.y.sub(Math.sin(HAZE_CORE.elevation * DEG_TSL)).div(HAZE_CORE.up);
    // (Narrower toward the card than toward the sun: the card keeps its calm pale air.)
    const toSunSide = smoothstep(-0.05, 0.05, dot(flat, vec2(Math.cos(coreAz), Math.sin(coreAz))));
    const across = mix(float(HAZE_CORE.across[0]), float(HAZE_CORE.across[1]), toSunSide);
    const offAcross = float(1.0).sub(dot(flat, coreFlat)).div(across.mul(across).mul(0.5));
    const core = exp(max(offAcross.add(offUp.mul(offUp)).negate(), -30.0))
        .mul(warmth).mul(mix(float(1.0), float(HAZE_CORE.pearl), u.pearl)).toVar();
    const lit = mix(golden, goldHue.mul(rbLuma(golden)), core.mul(HAZE_CORE.gold))
        .mul(core.mul(HAZE_CORE.gain).add(1.0));
    const indigo = u.col.gradeShadow.div(max(rbLuma(u.col.gradeShadow), 1e-4));
    const haze = mix(lit, indigo.mul(rbLuma(lit)), shadeSide.mul(HAZE_SHADE.indigo));
    // (The low air's glow off the mist is gold toward the sun too: HAZE_GOLD.glow.)
    const mistLight = mix(u.col.underglow, u.col.mistTop, 0.5);
    const glow = mix(mistLight, goldHue.mul(rbLuma(mistLight)), sunward.mul(HAZE_GOLD.glow));
    const risen = exp(clamp(u.tide.sub(u.hazeY).div(G.tide), -2.0, 2.0)).toVar();
    // (Breaking out on top of the mist, the low air is the haze itself: MIST_BREAKOUT.glow.)
    const kept = float(1.0).sub(rbBreakout(u).mul(MIST_BREAKOUT.glow)).toVar();
    const share = min(max(risen, G.floor).mul(G.mix), G.most).mul(down).mul(kept);
    const lowAir = mix(haze.mul(float(1.0).sub(up)), glow, share);
    const air = lowAir.add(u.col.underglow.mul(max(risen, G.floor).mul(down).mul(G.add).mul(kept)));
    // Rolled off under HAZE_PEAK (hue preserving, on the brightest channel), raised round the core.
    return rbRollOff(air, { knee: HAZE_PEAK.knee, peak: mix(float(HAZE_PEAK.peak), float(HAZE_CORE.peak), core) });
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
 * And the mist's light never stands over `peak` (scene-linear, its brightest channel, before the
 * exposure), rolled off from `knee`, wherever the mist shows through the haze (its transmittance
 * from `fade`[0] to [1]): its pools stay under the bloom's knee, which belongs to the flecks (a
 * pool that blooms reads as a lamp in the floor). Toward the horizon, where the haze in front
 * (already rolled off) is all there is, the light the haze's own pattern adds rolls off only from
 * the light under it, up to `roll` more: the haze is never rolled twice (it would step where the
 * air meets the mist).
 */
export const MIST_PEAK = Object.freeze({
    knee: 0.6, peak: 0.8, roll: 0.14, fade: Object.freeze([0.05, 0.3]),
});
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
 * flat, a billow could only read as a streak). With one octave (Low, Minimal) `one`: its light
 * takes `crest` from the height, only `amp` of two octaves' contrast, and its lees are only `lee`
 * as blue (a lone round dip would read as a crater, a lit far wall inside a dark ring).
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
    one: Object.freeze({ crest: 0.8, lee: 0.45, amp: 0.5 }),
});
/**
 * Broad pools of sunlight lie on the mist (the canopy's gobo seen from far: where its openings
 * cluster, the sun gets through in pools tens of metres across): where the sun ray from the mist
 * crosses the canopy plane, the gap mask read on a `tile` metre tile at a fixed `level` of its
 * pyramid, drifting with the canopy's wind, cut over `cut`; a pool lifts the top by up to `gain`.
 * Where a pixel covers more than `fade` metres of the plane the pools melt into their `mean` (the
 * cut's mean over the mask at that level), and on a grazing ray they melt as the billows do
 * (MIST_BILLOWS.graze): a ray near the horizon meets the plane so far off, and so slanted, that
 * the pools would only lie in horizontal bands.
 */
export const MIST_POOLS = Object.freeze({
    tile: 126, cut: Object.freeze([0.18, 0.4]), level: 2, gain: 0.7, fade: Object.freeze([12, 45]), mean: 0.066,
});
/**
 * A billow's lee side (from a slope of `from` toward the sun's opposite, full at the steepest)
 * turns up to `blue` of the way to a blue shadow: the shade haze's hue (`hue` of it, the rest
 * grey) at its own lightness; it is `dim` as much dimmer as a lit front is brighter (a shadow on
 * vapour is cool more than dark: dimmed as far as a front is lit, cream would only turn grey).
 * Warm on cool (§2.1: blue shadow fills its hollows, never a grey smudge): the shadow takes the
 * second of `blue` and `hue`, the skylight's full blue (a third of the way to it reads only as grey
 * on cream), under a warm-topped mist (the Bole, the Limb Storey, Crown Light: the top's red over
 * its blue, times `warmth`, reaching 1) or a pale shade haze (the Fog Line's pearl, Mistfall: its
 * blue's lead over its red, as a share of its blue, under `pale[0]`, none of this from `pale[1]`);
 * a cool top under a saturated shade (Buttress Deep) keeps the first (its deep blue there would read
 * as periwinkle puddles). A pale shade haze's hue is lent at least `chroma` of chroma (its colour
 * over its luminance, less one, at least this long): the pearl's own faint blue would leave the
 * hollows grey.
 */
export const MIST_HOLLOW = Object.freeze({
    blue: Object.freeze([0.6, 0.72]),
    hue: Object.freeze([0.65, 1.0]),
    warmth: 6,
    pale: Object.freeze([0.35, 0.7]),
    chroma: 0.5,
    dim: 0.75,
    from: 0.15,
});
/** How far the mist's hollows take the skylight's full blue (MIST_HOLLOW: 0 … 1). */
export const rbHollowBlue = (u) => {
    const warm = clamp(u.col.mistTop.x.sub(u.col.mistTop.z).mul(MIST_HOLLOW.warmth), 0.0, 1.0);
    const shade = u.col.hazeShade;
    const lead = shade.z.sub(shade.x).div(max(shade.z, 1e-3));
    const pale = float(1.0).sub(smoothstep(MIST_HOLLOW.pale[0], MIST_HOLLOW.pale[1], lead));
    return max(warm, pale);
};
/**
 * Warm on cool on the mist: where the sun's pools rest (from the pools' mean to `full` of the
 * cut, up to `pool` of the way) and on the billows' lit fronts (`front` of their light) the vapour
 * turns to the sun's gold (the zone's fleck hue at `chroma` times its chroma, at the vapour's own
 * lightness), the lees keeping their blue; in a pearly zone, 1 − `pearl` of it.
 */
export const MIST_GOLD = Object.freeze({
    pool: 0.9, full: 1.0, front: 0.3, chroma: 1.7, pearl: 0.6,
});
/**
 * The billows' and pools' light carried by the haze over the mist: `pattern` of their relative
 * light and `hollow` of the lees' blue, as far as the haze veils the top. The air over a sunlit
 * pool is itself in the sun (the canopy's light comes down through it), the air over a lee in
 * its shade; so the pattern survives the long slant down to the mist, which the veil alone would
 * wash out to a flat grey. Only the near air carries it: where less than `fade` of the top shows
 * through the haze (toward the horizon) it melts away, as the far billows would only streak.
 * Where the hollows take the full blue (rbHollowBlue) it is laid over the air's glow as a whole,
 * not only as far as the haze veils the top: the cream glow of the near air would otherwise wash
 * what blue is left back to grey.
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
 * A pale, neutral mist top (the Fog Line's pearl, Crown Light's white: its red's lead over its
 * blue, as a share of its blue, under `neutral`; a cream top, the Bole's, keeps its own) leans up
 * to `lean` of the way to the sun's cream (the zone's fleck colour at `chroma` times its chroma) on
 * the sun's side of the sky (the azimuth's cosine from `side[0]` to `side[1]`) and on the billows'
 * lit fronts (`front` of their light): warm on cool, the lees keeping their blue, never a neutral
 * snowfield.
 */
export const MIST_WARM = Object.freeze({
    lean: 0.6, chroma: 2.0, neutral: 0.2, side: Object.freeze([-0.2, 0.9]), front: 0.6,
});
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

/**
 * The eye's height over the tide (metres) over which the mist top's pattern (billows, lees, pools)
 * comes up from nothing to full: an eye at the top is in its thin upper vapour, which veils the
 * pattern to a soft glow (the Fog Line's c = 7 at high water).
 */
export const MIST_SKIM = Object.freeze([-1, 5]);
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
    const fine = float(1.0).sub(smoothstep(B.fade[0], B.fade[1], cells)).mul(graze).mul(u.billowK)
        .toVar();
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
    const range = mix(float(B.slopeRange), float(B.slopeRange * MIST_BREAKOUT.soften), rbBreakout(u));
    const slope = clamp(hv.sub(hs).div(range), -1.0, 1.0).mul(fine).toVar();
    const crest = smoothstep(B.ramp[0], B.ramp[1], hv).sub(0.5).mul(2.0).mul(fine);
    // (One octave, Low and Minimal: its lone round dips would read as craters, a lit far wall in a
    // dark ring, so its light comes mostly from the height and its lees are held lighter.)
    const crestK = billows > 1 ? B.crest : B.one.crest;
    const light = clamp(slope.mul(1 - crestK).add(crest.mul(crestK)), -1.0, 1.0)
        .mul(billows > 1 ? 1 : B.one.amp).toVar();
    // The lee: wherever the light falls (a slope turned from the sun, and the low ground between
    // billows as a whole, so a dip is one soft shadow, never a lit floor inside a dark ring).
    const lee = smoothstep(MIST_HOLLOW.from, 1.0, light.negate()).mul(billows > 1 ? 1 : B.one.lee);
    // The sun's broad pools: where the sun ray from the mist crosses the canopy plane.
    const up = u.canopyY.sub(seenY).div(max(u.sunDir.y, 0.2));
    const q = hit.add(u.sunDir.xz.mul(up)).div(MIST_POOLS.tile).add(u.wind.mul(GAP_MASK.tile / MIST_POOLS.tile))
        .add(vec2(0.13, 0.57));
    const pooled = smoothstep(MIST_POOLS.cut[0], MIST_POOLS.cut[1], u.gap(q, float(MIST_POOLS.level)));
    // An eye skimming the top sees it through its own thin vapour: the pattern softens as the eye
    // sinks to it (MIST_SKIM), never a crisp floor with a lit crest streaking at its feet.
    const skim = smoothstep(MIST_SKIM[0], MIST_SKIM[1], u.camPos.y.sub(u.tide)).toVar();
    const poolFine = float(1.0).sub(smoothstep(MIST_POOLS.fade[0], MIST_POOLS.fade[1], foot)).mul(graze).mul(skim);
    return vec3(light.mul(skim), lee.mul(skim), mix(float(MIST_POOLS.mean), pooled, poolFine));
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
    const lifted = col.mul(mix(float(1.0), lift, kLift)).toVar();
    // Where the sun's pools rest and on the lit fronts the vapour turns gold (MIST_GOLD).
    const gold = u.col.fleck.div(max(rbLuma(u.col.fleck), 1e-4)).sub(1.0).mul(MIST_GOLD.chroma).add(1.0);
    const pool = smoothstep(MIST_POOLS.mean, MIST_GOLD.full, field.z).mul(MIST_GOLD.pool);
    const goldK = min(pool.add(max(x, 0.0).mul(MIST_GOLD.front)), 1.0).mul(kLift)
        .mul(float(1.0).sub(u.pearl.mul(MIST_GOLD.pearl)));
    const lit = mix(lifted, max(gold, vec3(0.0)).mul(rbLuma(lifted)), goldK).toVar();
    const l = rbLuma(lit).toVar();
    const full = rbHollowBlue(u).toVar();
    const hue = mix(float(MIST_HOLLOW.hue[0]), float(MIST_HOLLOW.hue[1]), full);
    const blue = mix(float(MIST_HOLLOW.blue[0]), float(MIST_HOLLOW.blue[1]), full);
    const chroma = u.col.hazeShade.div(max(rbLuma(u.col.hazeShade), 1e-4)).sub(1.0).toVar();
    const long = max(length(chroma), 1e-4).toVar();
    const lent = chroma.mul(max(long, MIST_HOLLOW.chroma).div(long));
    const shadeHue = max(lent.mul(hue).add(1.0), 0.0).mul(l);
    return mix(lit, shadeHue, field.y.mul(kHollow).mul(blue));
}

/**
 * The mist floor's lit top along a downward direction (§4.4 item 4): cream, brighter toward the
 * sun, at the pools' mean lift, faintly tinted by the bark above (MIST_BLEED); then shaded by its
 * field (rbMistField: the billows' lit fronts and blue lees, the sun's pools).
 */
export function rbMistTop(u, dir, field) {
    const W = MIST_WARM;
    const forward = u.col.hazeSun.mul(rbHgMix(dot(dir, u.sunDir), float(0.6)).mul(0.25));
    const raw = u.col.mistTop.mul(MIST_TOP_LIGHT).add(forward);
    const mean = u.palette.element(int(PALETTE_ROWS.groupMean + 1)).xyz;
    const tint = mix(vec3(1.0), mean.div(max(rbLuma(mean), 1e-4)), MIST_BLEED);
    const base = raw.mul(tint).mul(1 + MIST_POOLS.gain * MIST_POOLS.mean).toVar();
    // A pale, neutral top leans to the sun's cream on its lit side (MIST_WARM).
    const top = u.col.mistTop;
    const neutral = float(1.0).sub(smoothstep(0.0, W.neutral, top.x.sub(top.z).div(max(top.z, 1e-3))));
    const flat = dir.xz.div(max(length(dir.xz), 1e-3));
    const side = smoothstep(W.side[0], W.side[1], dot(flat, normalize(u.sunDir.xz)));
    const lit = clamp(side.add(max(field.x, 0.0).mul(W.front)), 0.0, 1.0);
    const fleck = u.col.fleck.div(max(rbLuma(u.col.fleck), 1e-4));
    const cream = fleck.sub(1.0).mul(W.chroma).add(1.0).mul(rbLuma(base));
    const warmed = mix(base, max(cream, vec3(0.0)), neutral.mul(lit).mul(W.lean));
    return rbMistShade(u, warmed, field, float(1.0), float(1.0));
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
 * Breaking out on top of the mist, the vapour's light under the haze's along the same ray
 * (MIST_BREAKOUT.cap of its luminance, rolled off softly from 0.8 of that), as far as the eye is
 * breaking out (`breakout`, rbBreakout unless given): the haze is brighter than anything in it.
 */
export function rbUnderHaze(u, col, haze, breakout = null) {
    const k = breakout || rbBreakout(u);
    const capL = rbLuma(haze).mul(MIST_BREAKOUT.cap).toVar();
    const knee = capL.mul(0.8).toVar();
    const span = max(capL.sub(knee), 1e-4);
    const l = max(rbLuma(col), 1e-4).toVar();
    const rolled = knee.add(span.mul(float(1.0).sub(exp(max(l.sub(knee), 0.0).div(span).negate()))));
    return col.mul(mix(float(1.0), min(l, rolled).div(l), k));
}

/**
 * The vapour the mist floor shows along a direction: its lit top shaded by `field` (rbMistTop), or
 * from inside the mist its interior. Which one is a branch on the camera alone (coherent over the
 * frame), so only a camera at the mist's top pays for both. With the air's light along the ray
 * (`haze`), an eye breaking out on top sees the vapour toward the horizon melt into it
 * (MIST_BREAKOUT).
 */
export function rbVapour(u, dir, field, haze = null) {
    const inside = rbMistInside(u).toVar();
    const out = vec3(0.0).toVar();
    If(inside.lessThan(0.999), () => {
        out.assign(rbMistTop(u, dir, field));
    });
    If(inside.greaterThan(0.001), () => {
        out.assign(mix(out, rbMistInterior(u, dir), inside));
    });
    if (!haze) return out;
    const B = MIST_BREAKOUT;
    const breakout = rbBreakout(u).toVar();
    const capped = rbUnderHaze(u, out, haze, breakout);
    const low = float(1.0).sub(smoothstep(B.low.eye[0], B.low.eye[1], u.camPos.y.sub(u.tide)));
    const far = float(1.0).sub(smoothstep(B.fade[0], mix(float(B.fade[1]), float(B.low.fade), low), dir.y.negate()));
    return mix(capped, haze, far.mul(breakout));
}

/** How far from the eye (metres) the haze begins: the air nearer than this is clear. */
export const AIR_CLEAR = 12;
/**
 * A ray climbing steeply toward the canopy crosses only the thin air under the crowns, in their
 * shade (no sunlit motes there): from a slope (its sine) of `from` to `to` its haze thins to `thin`
 * of the profile's and the tide's air gain fades away, so the dark lace overhead reads through it
 * as the frame's darkest broad band, never a grey ceiling.
 */
export const AIR_UPWARD = Object.freeze({ thin: 0.75, from: 0.12, to: 0.5 });

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
    // nearer and brighter, never hazier. A ray climbing steeply toward the canopy crosses only
    // the thin air under the crowns (AIR_UPWARD).
    const upward = smoothstep(AIR_UPWARD.from, AIR_UPWARD.to, Vy).toVar();
    const gain = mix(float(1.0), u.airGain, smoothstep(-0.1, 0.05, Vy).mul(float(1.0).sub(upward)))
        .mul(mix(float(1.0), float(AIR_UPWARD.thin), upward));
    // The first AIR_CLEAR metres are clear (the haze builds with depth: the trunks nearest the eye
    // keep their darks against the luminous air instead of standing behind a veil of it).
    const clearNear = clamp(float(1.0).sub(float(AIR_CLEAR).div(d)), 0.0, 1.0);
    const tauA = select(abs(Vy).greaterThan(1e-3), slanted, level).mul(gain).mul(clearNear);
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
    const kHollow = mix(veil, w.mul(near), rbHollowBlue(u)).mul(MIST_AIR_PATTERN.hollow);
    const shaded = rbMistShade(u, over, field, kLift, kHollow).toVar();
    const cap = rbLuma(front).mul(MIST_LIFT.lift);
    const knee = cap.mul(MIST_LIFT.knee).toVar();
    const span = max(cap.sub(knee), 1e-4);
    const l = max(rbLuma(shaded), 1e-4).toVar();
    const rolled = knee.add(span.mul(float(1.0).sub(exp(max(l.sub(knee), 0.0).div(span).negate()))));
    const capped = shaded.mul(min(l, rolled).div(l)).toVar();
    // MIST_PEAK, from the light under the pattern (or its knee, if higher).
    const m = max(rbMax3(capped), 1e-5).toVar();
    const knee0 = max(float(MIST_PEAK.knee), rbMax3(over)).toVar();
    const roll = max(float(MIST_PEAK.peak).sub(knee0), MIST_PEAK.roll).toVar();
    const top = knee0.add(roll.mul(float(1.0).sub(exp(max(m.sub(knee0), 0.0).div(roll).negate()))));
    const kept = capped.mul(min(m, top).div(m)).toVar();
    const seenMist = smoothstep(MIST_PEAK.fade[0], MIST_PEAK.fade[1], Tx);
    return mix(shaded, mix(kept, rbRollOff(kept, MIST_PEAK), seenMist), w);
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
        vapour = rbVapour(u, dir, field, inscatter).toVar();
    }
    const front = mix(inscatter, vapour, inside).toVar();
    const over = rbAirOver(col, T, front, vapour).toVar();
    // How much of the pixel is the mist's vapour (none from inside: there it is the air).
    const sunk = opaque ? float(1.0) : float(1.0).sub(T.y);
    const w = sunk.mul(float(1.0).sub(inside)).toVar();
    const midway = T.x.mul(float(1.0).sub(T.x)).mul(float(1.0).sub(w)).toVar();
    const violet = u.col.hazeShade.mul(vec3(...AIR_PASTEL.violet));
    const tint = violet.sub(vec3(rbLuma(violet))).div(max(rbLuma(violet), 1e-4)).mul(rbLuma(over));
    // (Times the mist's own transmittance: a colour the vapour hides never leaks its hue.)
    const pastel = col.sub(vec3(rbLuma(col))).mul(AIR_PASTEL.keep).add(tint.mul(AIR_PASTEL.tint)).mul(midway)
        .mul(T.y);
    return rbMistAir(u, over.add(pastel), field, T.x, front, w);
}

/** How much of the canopy plane the crowns cover where no field is baked (the rest is sky). */
const CANOPY_COVER = 0.72;
/** How far below the canopy plane (metres) a trunk starts to dissolve into it (twice: its shade). */
export const CANOPY_SHADE = 14;
/**
 * A trunk's or limb's dissolving top turns from the crowns' leaves alone to the canopy as the
 * backdrop paints it (openings and all) over its whole band, so its tube ends in the very pixel
 * painted round it (never a flat-topped post, nor a column of leaves, standing under a gap); the
 * crowns' shade on it comes in over at least `shade` metres.
 */
export const CANOPY_TOP = Object.freeze({ shade: 6 });
/**
 * A limb melts into the leaves over the last of its length, from this share of it on (whatever
 * height it is seen from: a branch runs into the foliage, never ends in open air).
 */
export const LIMB_INTO = 0.65;
/**
 * Up in the crowns a limb stands in their shade: from `from` metres under the canopy plane (fully
 * at `to`) its light falls to `light` and its colour keeps `chroma` of its saturation, so the limbs
 * read as dark lines running into the leaves, never lit, striped poles.
 */
export const LIMB_SHADE = Object.freeze({
    from: 40, to: 22, light: 0.5, chroma: 0.5,
});
/** The same for the far grove (its tops seen from below melt into the lace over a longer climb). */
export const CANOPY_SHADE_FAR = 30;
/**
 * Those bands shrink as the eye nears the canopy: to the eye's height under it over `ref` metres
 * of them, never under `least` of them; from inside the mist they are `mist` times as long (the
 * canopy is lost in the vapour, so a trunk's top dissolves upward into it long before its
 * silhouette could end against the pearl).
 */
export const CANOPY_FADE_NEAR = Object.freeze({ ref: 60, least: 0.3, mist: 2.5 });
/**
 * The canopy as foliage seen from below (rbCanopy): dark clumps of leaves against the bright sky.
 *  - The leaves are a signed field (bakeCrownField: metres to the leaves' edge, + in the leaves):
 *    round clumps in leaf masses through every crown, ragged by pointed sprays of leaves, the
 *    channels of crown shyness between the crowns. It is read at the pixel's footprint (`bias`
 *    mips over it; the geometric mean of the footprints across and down the ray) and the sky
 *    shows where it falls under `cut` metres (+ more sky), its edge `aa` pixels soft whatever the
 *    distance: crisp, scalloped convex arcs and pointed sprays, never a blurred iso-line.
 *  - The crown tile is laid in cells (texture bombing: each cell turned a quarter turn or mirrored,
 *    one of eight ways, and shifted by a hash of its place), and every cell's edges blended over
 *    `seam` metres into three more lattices of cells offset half a cell along x, along z and both
 *    (each weighing nothing at its own edges), so no repeat lines up and no seam shows.
 *  - Near, where a leaf is more than a pixel, the leaf lace (bakeLeafLace, read `ragBias` mips over
 *    the footprint: whole blades, never pixel grain) rags the edge with single lanceolate leaves
 *    (`rag` metres of its detail either way).
 *  - No opening narrower than `least` pixels (the first at the Bole, the second just under the
 *    canopy) is drawn: the field holds every opening's half-width (its widest disc of sky), and an
 *    opening whose half-width falls under half of `least` pixels (down the ray, where a slanting
 *    opening is thinnest on screen; pixels of a frame `rows` tall at most, so a smaller drawing
 *    buffer draws the same openings) closes (from 1.5 times it), so
 *    never a hairline vein nor a scatter of white chips: the canopy closes far off by its openings
 *    dropping out whole, never by its edges blurring.
 *  - The cut rises by `under` metres just under the canopy (the Limb Storey and Crown Light: more
 *    sky; from `near[0]` metres under the canopy, fully at `near[1]`); a slanting ray crosses more
 *    leaves, so it falls by `layers` metres per unit of cot(elevation): the canopy closes toward the
 *    horizon and opens toward the zenith.
 *  - The leaves: dark crown green (`light` of it: the first far below the canopy, where more
 *    leaves stand overhead and less light comes through, the second just under it; each leaf mass
 *    its own tone within ±`tone`),
 *    darker toward a clump's heart (to `core[2]` of it from `core[0]` to `core[1]` metres in), and
 *    the leaves nearest an opening (`rim` metres, or a pixel and a half if wider) lit through toward
 *    their backlit edge (#6E9A4A at the Bole) by the forward scatter (`rimLit` of the way at most);
 *    where single leaves resolve only the leaves themselves are lit (`fringe`: the lace from
 *    `fringe[0]` to `fringe[1]`; far, `fringe[2]` of the rim): a fringe of lit leaves, never a band
 *    tracing the opening. The mass glows toward the sun (up to 1 + `glow`). The crowns' limbs (the
 *    field's G) are dark lines across the openings (`limbs[0]` of the way to the leaves' darkest;
 *    none in the crown gap's heart, where they would read as cracks in the light, nor where a
 *    pixel covers over `limbFoot[1]` metres, from `limbFoot[0]`: a limb thinner than a couple of
 *    pixels draws hairline cracks) and faintly over the leaves (`limbs[1]`). Round the crown gap's
 *    heart its light comes through the leaves (`heartLit` of the way to their backlit green).
 *  - Through an opening: the sky, Skylight low and the zone's zenith azure overhead (from a sine of
 *    `zenith[0]` to `zenith[1]`), `lift` brighter far below the canopy (gone half-way up the
 *    near band, none from the Limb Storey's middle up: a glow
 *    seen through the haze, light coming in), up to `sunGap` brighter toward the sun; only the
 *    openings toward the sun (the narrow forward scatter from `toward[0]` to `toward[1]`) whiten,
 *    `whiten` of the way to the light grade's cream.
 *  - Along the ray the canopy reads to `seen[0]` metres and melts into its own mean by `seen[1]`
 *    (`seen[2]` just under the canopy, where the band runs down to the horizon): dark leaves with
 *    `farOpen` of sky; that mean then melts into the air's own light along the ray over `seen[2]`
 *    to `seen[3]` (so the far band ends in the haze, never on a step); just under the canopy the
 *    openings close from `closeFar[0]` to `closeFar[1]` metres along the ray. In a pearly zone (u.pearl: the
 *    Fog Line, Mistfall) those distances are `pearl` as long, no opening shows and the canopy is
 *    `faint[0]` of the way to the shade haze at `faint[1]` of its light: a faint shadow high in the
 *    pearl.
 *  - Low and Minimal (`lite`) keep the picture on fewer reads: no leaf lace (the field's sprays rag
 *    the edges alone) and no crown-gap lobes; the size test is the same field's. With no bloom to
 *    lift the dark leaves against the bright sky (its halation), their leaves are `liteLift` as
 *    light.
 */
export const CANOPY = Object.freeze({
    bias: 0.0,
    aa: 0.9,
    seam: 6,
    rag: 0.22,
    ragBias: 0.75,
    least: Object.freeze([4, 3.5]),
    rows: 1080,
    cut: -0.3,
    under: 0.5,
    near: Object.freeze([70, 20]),
    layers: 0.16,
    light: Object.freeze([0.25, 1.0]),
    liteLift: 1.6,
    tone: 0.2,
    core: Object.freeze([0.4, 2.2, 0.6]),
    rim: 0.3,
    rimLit: 1.1,
    fringe: Object.freeze([0.45, 0.75, 0.55]),
    glow: 0.35,
    limbs: Object.freeze([0.9, 0.3]),
    limbFoot: Object.freeze([0.1, 0.25]),
    heartLit: 0.4,
    zenith: Object.freeze([0.15, 0.85]),
    lift: 1.5,
    sunGap: 0.6,
    toward: Object.freeze([0.45, 0.9]),
    whiten: 0.6,
    seen: Object.freeze([230, 290, 600, 900]),
    closeFar: Object.freeze([110, 200]),
    pearl: 0.45,
    faint: Object.freeze([0.7, 0.75]),
    farOpen: 0.05,
});
/** The backlit edge of a leaf: the crown's green, translucent, a little warm (#6E9A4A at the Bole). */
const BACKLIT_GAIN = 3.6;
const BACKLIT_WARM = [0.06, 0.09, 0.0];
/**
 * The crown gap above the card (§2.6): one opening of sky-white light (`white` of the way from
 * the sky to the zone's light grade, times `gain`, at its centre; the sky at its rim) behind dark
 * lace, centred straight ahead at `elevation` degrees and `radius` times the lens's vertical
 * half-tangent across (so it is the same size on any screen), at full strength on an upright
 * screen and `landscape` of it on a wide one. Toward its heart the canopy's cut rises by `open`
 * metres, so clump after clump falls away and the gap is ringed by their silhouettes (never a blob
 * cut by a noise).
 */
export const CROWN_GAP = Object.freeze({
    elevation: 42, radius: 0.26, soft: 0.5, landscape: 0.3, white: 0.6, gain: 1.2, open: 2.4,
});

/**
 * The crown field's texel coordinates (tiles) for a point of the canopy plane `g` (tiles) in a
 * cell of the bombing lattice: the cell's eight-way turn (quarter turns and a mirror) about its
 * centre, and its shift, from a hash of the cell and `salt`.
 */
const crownCell = (g, salt) => {
    const cell = floor(g);
    const f = fract(g).sub(0.5);
    const h = rbHash21(cell.add(vec2(salt, 41.3)));
    const k = floor(h.mul(8.0));
    const quarter = floor(k.mul(0.5));
    const flip = k.sub(quarter.mul(2.0)).mul(2.0).sub(1.0);
    const fx = f.x.mul(flip);
    const a = quarter.mul(Math.PI / 2);
    const c = floor(cos(a).add(0.5));
    const s = floor(sin(a).add(0.5));
    const shift = vec2(rbHash21(cell.add(vec2(71.1, salt))), rbHash21(cell.add(vec2(salt, 97.7))));
    return vec2(fx.mul(c).sub(f.y.mul(s)), fx.mul(s).add(f.y.mul(c))).add(shift);
};

/**
 * The canopy where a view ray meets its plane (§4.4 item 3), seen through the air: dark clumps of
 * leaves against the bright sky (CANOPY), read in perspective at the footprint, the crowns' limbs
 * running across its openings, the crown gap above the card on an upright screen (CROWN_GAP);
 * near, single leaves rag its edges. Far along the ray it melts into the air. The backdrop paints
 * it above the horizon; a trunk or a limb dissolves into it where it enters the canopy (`solid`:
 * how far its openings are filled with leaves, so a tube enters the leaves, never a hole).
 * @param {object} u    the shared uniforms (with textures)
 * @param {object} dir  unit view direction (vec3 node)
 * @param {object} [pre]  the air's inscatter and vapour along dir, when the caller has them
 * @param {object} [options]
 * @param {object} [options.solid]  how far the openings are filled with leaves (float node 0 … 1)
 * @param {boolean} [options.lite]  Low and Minimal: fewer reads (CANOPY)
 */
export function rbCanopy(u, dir, pre = null, { solid = null, lite = false } = {}) {
    const C = CANOPY;
    const upY = max(dir.y, 1e-3).toVar();
    const t = max(u.canopyY.sub(u.camPos.y), 1.0).div(upY).toVar();
    const at = u.camPos.add(dir.mul(t)).toVar();
    const sky = mix(u.col.sky, u.col.zenith, smoothstep(C.zenith[0], C.zenith[1], dir.y)).toVar();
    if (!u.lace || !u.crowns) return rbAir(u, mix(sky, u.col.crown, CANOPY_COVER), at, pre, { billows: 0 });
    const q = at.xz.toVar();
    // A pixel's footprint on the plane (metres): across the ray, down it (stretched by the
    // slant), and their geometric mean; and the slant itself.
    const across = t.mul(u.pixelAngle).toVar();
    const foot = across.mul(inversesqrt(upY)).toVar();
    const cot = sqrt(max(float(1.0).sub(upY.mul(upY)), 0.0)).div(upY).toVar();
    const under = smoothstep(u.canopyY.sub(C.near[0]), u.canopyY.sub(C.near[1]), u.camPos.y).toVar();
    // ── The crown field, bombed: lattices of turned, mirrored, shifted cells, every edge blended
    // over CANOPY.seam (fixed levels: the backdrop is branched) ──
    const T = CANOPY_CROWNS.tile;
    const texel = T / u.tex.crowns.image.width;
    const lod = clamp(log2(foot.div(texel)).add(C.bias), 0.0, 9.0).toVar();
    // (Four lattices, offset half a cell along x, along z and both: each weighs nothing at its own
    // edges, so the blend is seamless; inside a cell only the first is read.)
    const g = q.div(T).toVar();
    const fA = fract(g).sub(0.5);
    const tx = smoothstep(0.0, C.seam, float(0.5).sub(abs(fA.x)).mul(T)).toVar();
    const tz = smoothstep(0.0, C.seam, float(0.5).sub(abs(fA.y)).mul(T)).toVar();
    const field = u.crowns(crownCell(g, 13.7), lod).mul(tx.mul(tz)).toVar();
    const seamX = tx.lessThan(0.999);
    const seamZ = tz.lessThan(0.999);
    If(seamX, () => {
        field.addAssign(u.crowns(crownCell(g.add(vec2(0.5, 0.0)), 29.3), lod).mul(float(1.0).sub(tx).mul(tz)));
    });
    If(seamZ, () => {
        field.addAssign(u.crowns(crownCell(g.add(vec2(0.0, 0.5)), 47.9), lod).mul(tx.mul(float(1.0).sub(tz))));
    });
    If(seamX.and(seamZ), () => {
        field.addAssign(u.crowns(crownCell(g.add(0.5), 61.1), lod).mul(float(1.0).sub(tx).mul(float(1.0).sub(tz))));
    });
    const R = CANOPY_CROWNS.range;
    const d = field.x.mul(2 * R).sub(R).toVar();
    const limb = field.y;
    const halfWidth = field.z.mul(R);
    const tone = field.w;
    // ── Near, single leaves rag the edge (the lace's detail against its own coarser read) ──
    let leaf = float(0.5);
    let nearK = float(0.0);
    if (!lite) {
        const size = u.tex.lace.image.width;
        const { tile } = CANOPY_LACE;
        const lodL = clamp(log2(foot.div(tile / size)).add(C.ragBias), 0.0, 9.0).toVar();
        nearK = float(1.0).sub(smoothstep(1.0, 2.5, lodL)).toVar();
        const st = q.div(tile).add(vec2(0.37, 0.61)).toVar();
        leaf = u.lace(st, lodL).toVar();
        d.addAssign(leaf.sub(u.lace(st, lodL.add(2.0))).mul(C.rag * 2).mul(nearK));
    }
    // ── The crown gap above the card: clumps fall away toward its heart (upright screens) ──
    const el = CROWN_GAP.elevation * DEG_TSL;
    const offset = dir.sub(vec3(0.0, Math.sin(el), -Math.cos(el)));
    // An irregular opening: its radius wanders with a broad noise round it.
    let wander = float(1.0);
    if (!lite) {
        const lobes = u.fbmLod(offset.xz.div(u.tanHalf.y.mul(CROWN_GAP.radius * 3)).add(vec2(0.31, 0.77)), 3.0);
        wander = lobes.r.mul(0.7).add(lobes.g.mul(0.3)).sub(0.5).mul(1.1)
            .add(1.0);
    }
    const toward = length(offset).div(u.tanHalf.y.mul(CROWN_GAP.radius).mul(wander)).toVar();
    const upright = float(1.0).sub(smoothstep(0.62, 1.5, u.tanHalf.x.div(u.tanHalf.y)));
    const strength = mix(float(CROWN_GAP.landscape), float(1.0), upright).toVar();
    const gapField = float(1.0).sub(smoothstep(1.0 - CROWN_GAP.soft, 1.0 + CROWN_GAP.soft, toward)).mul(strength);
    // ── The cut (metres, + more sky): higher just under the canopy and toward the crown gap's
    // heart, lower as the ray slants through more leaves ──
    const cut = float(C.cut).add(under.mul(C.under)).add(gapField.mul(CROWN_GAP.open))
        .sub(cot.mul(C.layers))
        .toVar();
    const dd = d.sub(cut).toVar();
    // ── The openings: crisp at any distance; none narrower than CANOPY.least pixels ──
    // (Measured down the ray, where a slanting opening is thinnest on screen: far off the canopy
    // closes by its openings dropping out whole. In pixels of a frame `rows` rows tall at most: a
    // smaller drawing buffer, Low's or a phone's, draws the same openings, never fewer and so chips.)
    const least = mix(float(C.least[0]), float(C.least[1]), under);
    const designPx = min(u.pixelAngle, u.tanHalf.y.mul(2 / C.rows));
    const narrowest = least.mul(0.5).mul(t.mul(designPx).div(upY)).toVar();
    const wide = max(halfWidth.add(cut), dd.negate());
    const kept = smoothstep(narrowest, narrowest.mul(1.5), wide);
    const w = foot.mul(C.aa).toVar();
    const open = float(1.0).sub(smoothstep(w.negate(), w, dd)).mul(kept).toVar();
    // ── The leaves' colour: a clump's heart dark, the leaves nearest an opening lit through toward
    // the sun (a fringe of single leaves where they resolve), the mass glowing toward the sun ──
    const cosSun = dot(dir, u.sunDir).toVar();
    const sunward = rbHgMix(cosSun, float(0.75)).toVar();
    const forward = rbHgMix(cosSun, float(0.5));
    const glow = sunward.mul(C.glow).add(1.0).toVar();
    const backlit = u.col.crown.mul(BACKLIT_GAIN).add(vec3(...BACKLIT_WARM)).toVar();
    // (Low and Minimal have no bloom to lift the dark leaves against the bright sky: CANOPY.liteLift.)
    const lightOf = u.col.crown.mul(mix(float(C.light[0]), float(C.light[1]), under)).mul(lite ? C.liteLift : 1)
        .toVar();
    const inLeaves = max(dd, 0.0);
    const rim = float(1.0).sub(smoothstep(0.0, max(float(C.rim), foot.mul(1.5)), inLeaves));
    const core = smoothstep(C.core[0], C.core[1], inLeaves);
    const deep = lightOf.mul(mix(float(1.0 - C.tone), float(1.0 + C.tone), tone))
        .mul(mix(float(1.0), float(C.core[2]), core));
    const fringe = rim.mul(mix(float(C.fringe[2]), smoothstep(C.fringe[0], C.fringe[1], leaf), nearK));
    let leafCol = mix(deep, backlit, fringe.mul(min(forward.mul(C.rimLit), 1.0))).mul(glow);
    if (!lite) leafCol = mix(leafCol, lightOf.mul(C.core[2]), limb.mul(C.limbs[1]));
    leafCol = leafCol.toVar();
    // (A limb narrower than a couple of pixels would only draw hairline cracks: CANOPY.limbFoot.)
    const limbK = limb.mul(float(1.0).sub(smoothstep(C.limbFoot[0], C.limbFoot[1], foot))).toVar();
    // ── Through an opening: the sky (brighter far below, toward the sun; only the openings toward
    // the sun whiten), crossed by the crowns' limbs; the crown gap's heart sky-white ──
    const sunlit = sky.mul(sunward.mul(C.sunGap).add(1.0)).toVar();
    const whiten = smoothstep(C.toward[0], C.toward[1], sunward).mul(C.whiten);
    const lift = float(1.0).sub(smoothstep(0.0, 0.5, under)).mul(C.lift).add(1.0);
    const white = mix(sky, u.col.gradeLight, CROWN_GAP.white).mul(CROWN_GAP.gain);
    const heart = float(1.0).sub(smoothstep(0.0, 1.0, toward)).mul(strength);
    // (Round the crown gap's heart its light comes through the leaves too: CANOPY.heartLit.)
    leafCol.assign(mix(leafCol, backlit.mul(glow), heart.mul(C.heartLit)));
    let through = mix(mix(sunlit, u.col.gradeLight.mul(rbMax3(sunlit)), whiten).mul(lift), white, heart.mul(heart));
    through = mix(through, lightOf.mul(C.core[2]), limbK.mul(C.limbs[0]).mul(float(1.0).sub(heart))).toVar();
    // From inside the mist its openings glow only as far as the vapour lets their light through
    // (scattered on the way: never crisp specks of sky through metres of mist), and the crowns
    // themselves fade into its glowing top as much again (the vapour overhead is lit from above:
    // from under it, the canopy is a shadow in the light, never a dark lid). In a pearly zone, and
    // in a trunk's dissolving top (`solid`), no opening shows.
    const seenAt = t.div(mix(float(1.0), float(C.pearl), u.pearl)).toVar();
    // (Just under the canopy, where the band runs on toward the horizon, the openings close from
    // `closeFar[0]` to `closeFar[1]` metres along the ray: the far crowns read as one leafy band
    // under the gold air, never warm-white slivers.)
    open.mulAssign(float(1.0).sub(smoothstep(C.closeFar[0], C.closeFar[1], seenAt).mul(under)));
    const veiled = rbAirTransmittance2(u, at).y.toVar();
    const inside = rbMistInside(u).toVar();
    open.mulAssign(mix(float(1.0), veiled.mul(veiled), inside).mul(float(1.0).sub(u.pearl)));
    if (solid) open.mulAssign(float(1.0).sub(solid));
    // (In a pearly zone the canopy is a faint shadow in the pearl: CANOPY.faint.)
    const canopy = mix(mix(leafCol, through, open), u.col.hazeShade.mul(C.faint[1]), u.pearl.mul(C.faint[0])).toVar();
    const lost = pre ? mix(canopy, pre.vapour, inside.mul(float(1.0).sub(veiled))) : canopy;
    // Beyond what can be told apart the canopy is its mean (dark leaves with `farOpen` of sky), and
    // farther still the air's own light along the ray (in a pearly zone those distances are
    // `pearl` as long).

    const seen = float(1.0).sub(smoothstep(C.seen[0], mix(float(C.seen[1]), float(C.seen[2]), under), seenAt));
    const meanTone = mix(
        mix(lightOf.mul(C.core[2]).mul(glow), sunlit, C.farOpen),
        u.col.hazeShade.mul(C.faint[1]),
        u.pearl.mul(C.faint[0]),
    );
    const airLight = pre ? pre.inscatter : rbInscatter(u, dir);
    const farTone = mix(meanTone, airLight, smoothstep(C.seen[2], C.seen[3], seenAt));
    // (The canopy is never seen through the mist's top: from under the top it is the interior.)
    return rbAir(u, mix(farTone, lost, seen), at, pre, { billows: 0 });
}

/**
 * The value inside a younger patch (fresh bark is flat, bright satin with little texture: the bark
 * notes' #4, #5): lighter toward one end, its own way along the trunk (a slow wave of `wave`
 * radians a metre, ±`end`), toward one edge (a wave round the trunk, `acrossCycles` to an atlas
 * tile, ±`across`), a low mottle (±`mottle` over the coarse grain's broad bands), its rim `rim`
 * lighter over `rimWidth` metres (the fresher edge), and only a trace of the grain (`grain` of the
 * worn bark's streaks, striation and fine mottle) and a very slight value noise both ways alike
 * (±`iso`/2 over BARK_ISO's 10 cm cells); its colour drifts by up to ±`drift`/2 of age across it.
 */
export const BARK_PATCH_VALUE = Object.freeze({
    wave: 0.3,
    end: 0.09,
    across: 0.05,
    acrossCycles: 4,
    mottle: 0.12,
    rim: 0.06,
    rimWidth: 0.08,
    drift: 0.04,
    grain: 0.12,
    iso: 0.18,
});
/**
 * The worn bark's texture (the slate matrix, fully; an old patch, BARK_WORN.patch of it): broad
 * faint streaks along the grain (±`streaks`/2, the fine grain's broad band), striation (±`lines`/2,
 * filtered through its mips), a mottle that runs both ways alike (BARK_ISO's square tile: ±`mottle`/2
 * over 10 cm cells and ±`mottleFine`/2 over 5 cm) and tiny lighter flecks (`speck` lighter where
 * the 5 cm band passes `specks`). The streaks and the striation are kept faint: they are what
 * reads as brushed metal when they lead.
 */
export const BARK_WORN = Object.freeze({
    patch: 0.35,
    streaks: 0.1,
    lines: 0.08,
    mottle: 0.56,
    mottleFine: 0.2,
    speck: 0.14,
    specks: Object.freeze([0.8, 0.9]),
});
/** The isotropic grain's tile (metres both ways; it divides BARK_TILE.around, so it never seams). */
export const BARK_ISO = 1.6;
/**
 * The bark's relief on the detail tiers (Medium and up), on worn bark: the striation's ridges tilt
 * the normal by the slope of their height round the trunk (`grain` times the difference of two
 * taps `step` texels apart, at most `grainMax` radians), and a broad ripple runs both ways alike
 * (BARK_ISO's 40 and 80 cm bands, at most `rippleMax`; `young` of it on fresh satin), so a fleck
 * breaks up on the slate and lies whole on a jewel patch. The ridges tilt only the direct light, and
 * only on bark turned to the sun (N·L from `lit`[0], full at [1]).
 */
export const BARK_RELIEF = Object.freeze({
    grain: 1.0, grainMax: 0.12, step: 2, rippleMax: 0.06, young: 0.3, lit: Object.freeze([0.2, 0.5]),
});
/**
 * The bark's light (§2.4, as the painting needs it):
 *   sky        the sky fill's share on upright bark (plus 0.2 · N.y), cool: `blue` of the way from
 *              the zone's sky to its shade haze (the shade half of a trunk reads blue-violet; on
 *              old slate `slateBlue` of the way, so the matrix stays a cool blue-grey in shade
 *              against the warm glow from below);
 *              the bark turned from the open air (a sun-side cosine under skyOpen[1]) sees less
 *              of it, down to skyOpen[0] of it facing straight away (the grove is dense there):
 *              the shade side darkens toward its far edge, so a trunk reads round;
 *   bounce     the mist's warm bounce on the bark (rbBounce), this much of it: [0] on bark turned to
 *              the sun or over the eye, rising to [1] on the shade side below it (as the square of
 *              rbBelowEye: the glow gathers toward the frame's foot; only on the near trunks, fading
 *              out from `footNear`[0] to [1] metres off, so the farther trunks keep their feet in
 *              the air's light, never a pale band across the grove; the left half lit
 *              from below by a warm glow off the mist floor, §2.1), never warming the whole shade
 *              side at the eye's height; and `glaze` of the floor's glaze on the satin (rbGlaze:
 *              added light, so more of it would grey the shade's colours; [0] to [1] as the
 *              bounce);
 *   fleck      the flecks' light on the bark against the sun's (the brightest light in the frame:
 *              over the air's, so the flecks carry the top of the range): [0] on younger bark, [1]
 *              on the old slate (dark and cool, it would otherwise take a fleck as a dim cream, no
 *              brighter than the air: there a fleck lands gold and bright); only on a fleck's body
 *              (its light from `fleckBody`[0] to [1], where the flecks are whole), never on the
 *              dapple between them or their mean where they melt, and only on the low storeys'
 *              broad soft flecks (the eye's mask level over FLECK.sharpenLod, down to none at the
 *              Limb Storey's small crisp ones);
 *   youngSky   how much of its blue young bark is spared (its colours survive the shade);
 *   haze       the broad warm light of the bright haze on the sun's side (hazeSun), from a sun-side
 *              cosine of `hazeFrom` (round past the terminator) to full facing the sun: [0] on a
 *              trunk in the clear air near the eye (AIR_CLEAR), [1] on one standing in the haze
 *              (from hazeNear[0] to hazeNear[1] times AIR_CLEAR off), which it lights broadly
 *              round its sun side;
 *   shadeChroma the chroma lift coloured bark (every age short of the slate, `vividTo`) takes in
 *              its indirect light, so ember and rust stay red-orange in the shade, never maroon;
 *   slateSun   how much richer old slate takes the sun (its gold pushed this much further from its
 *              grey: on the cool slate a fleck would otherwise cancel to a pale cream, and it
 *              should land near Fleck Gold while the slate around it stays cool);
 *   groove     how much of the fill a flute's groove loses (the trunk reads carved, its shade
 *              never one flat value);
 *   lipTurn    how far a lifted lip's normal turns up (so it takes a little more of the sun), and
 *   lip        how much lighter its bark is (its own colour lit, never a white line);
 *   terminator the N·L over which a fleck's light fades in, and its contrast melts into the
 *              flecks' mean below terminator × `graze` (a fleck stretched along a grazing surface
 *              would draw a long bar: two or three of them side by side read as stripes);
 *   fleckPx    a pinhole image under fleckPx[0] pixels melts into the flecks' mean (full at [1]);
 *   fleckFar   and beyond fleckFar[0] metres the flecks' contrast and the sheen fade toward
 *              their mean, falling by 1/e every fleckFar[1] metres (the far ranks' flecks would
 *              otherwise ladder their edges in even dashes; §2.1 depth cue 7);
 *   sunFloor   the sun's side never falls under `k` times the flecks' mean light (from N·L
 *              `ndl`[0] to [1]; `k`[0] on the near trunks, `k`[1] beyond `dist`[0]…[1] metres, where
 *              a pinhole's image is too big for a trunk to catch whole flecks often): between
 *              flecks the lit side of every trunk reads against its shade side. That light is the
 *              canopy's diffuse glow, `warm` of the way from neutral to the sun's gold (the slate
 *              between the flecks stays cool; only the flecks are gold).
 */
export const BARK_LIGHT = Object.freeze({
    sky: 0.28,
    skyOpen: Object.freeze([0.25, 0.5]),
    blue: 0.45,
    slateBlue: 0.8,
    bounce: Object.freeze([0.35, 1.7]),
    glaze: Object.freeze([0.55, 3.0]),
    fleck: Object.freeze([1.6, 3.4]),
    fleckBody: Object.freeze([0.15, 0.6]),
    footNear: Object.freeze([14, 24]),
    youngSky: 0.5,
    haze: Object.freeze([0.35, 1.0]),
    hazeFrom: Object.freeze([0.3, -0.1]),
    hazeNear: Object.freeze([0.9, 1.8]),
    shadeChroma: 0.8,
    vividTo: Object.freeze([0.86, 0.9]),
    slateSun: 0.35,
    groove: 0.3,
    lipTurn: 0.4,
    lip: 0.15,
    terminator: 0.25,
    graze: 1.6,
    fleckPx: Object.freeze([2, 6]),
    fleckFar: Object.freeze([20, 45]),
    sunFloor: Object.freeze({
        k: Object.freeze([0.6, 2.2]), dist: Object.freeze([12, 18]), ndl: Object.freeze([0.0, 0.3]), warm: 0.35,
    }),
});
/**
 * A fleck's light on the bark (albedo times the sun's direct light) never stands over `peak`
 * (its brightest channel, after the zone's exposure: scene-linear it is `peak` over u.exposure),
 * rolled off from `knee` with its hue kept (rbRollOff): a fleck glows in the patch's own colour,
 * never a blank cream or white sticker over it (the filmic's path to white starts above it). In a
 * pearly zone (u.pearl) the mist overhead takes `pearl` of the sun's direct light. Bark of low
 * chroma (old slate, husk) takes the sun's gold in its light, up to `gold` of the way to Fleck
 * Gold's hue at its own lightness (1 − its chroma of that), in every zone: warm on cool, never a
 * grey-white paper patch on the slate.
 */
export const FLECK_SHOULDER = Object.freeze({
    knee: 0.75, peak: 1.3, pearl: 0.6, gold: 0.5,
});
/** Fleck Gold (#FFE3A0) as a hue at unit luminance: what low-chroma bark takes in the sun. */
const FLECK_GOLD_HUE = (() => {
    const c = hexToLinear('#FFE3A0');
    const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return c.map((v) => v / l);
})();
/**
 * The wet satin's sheen and glints: Schlick's f0, its strength `k`, the forward-scattering haze's
 * extra brightness in what it mirrors toward the sun (`glow`), the share the shade side keeps
 * (`shade`), at most `most` (scene-linear, on its brightest channel: at the silhouette the sheen
 * must not stack into a white band that blooms), and less by `fleck` of a fleck's light where one
 * lands (the two never stack into white); and the sun's glints (GGX-lite, at most `glintMax` of
 * the lobe, times `glint`).
 */
export const BARK_SHEEN = Object.freeze({
    f0: 0.05, k: 0.85, glow: 0.8, shade: 0.35, most: 1.2, fleck: 0.8, glint: 0.6, glintMax: 40,
});

/**
 * The canopy's sunfleck at a world point (§4.5; the TSL twin of fleckAt): 0 shade … 1 a fleck's
 * heart (up to FLECK.pools in a combo gap's pool). The point's sun ray runs dC up to the canopy
 * plane and crosses it at q; there the sun's disc makes every opening a pinhole image
 * FLECK.disc·dC metres across, so the gap mask is read at that size's level (finer as the point
 * climbs toward the canopy: smaller, crisper flecks), gained so a pinhole's image stays a bright
 * disc, and cut at the zone's threshold over a soft rim, the canopy's dapple between (FLECK). The
 * mask drifts with u.wind. `lod`: 'pixel' (a level per pixel), 'penumbra' (plus a second, crisper
 * tap: a defined disc in its soft halo), or 'fixed' (the eye's level, u.fleckLod, for the whole
 * frame). `pools` adds the combo gaps' pools (max-combined, never summed: §6.6).
 * Every read gives its level, so it may sit inside a branch.
 */
export function rbFleck(u, P, { lod: mode = 'pixel', pools = false } = {}) {
    const L = u.sunDir;
    const dC = max(u.canopyY.sub(P.y), 0.0).div(max(L.y, 0.2)).toVar();
    const q = P.xz.add(L.xz.mul(dC)).toVar();
    const texel = GAP_MASK.tile / GAP_MASK.size;
    const lod = mode === 'fixed'
        ? u.fleckLod
        : clamp(log2(max(dC.mul(FLECK.disc), texel).div(texel)), 0.0, FLECK.maxLod).toVar();
    const st = q.div(GAP_MASK.tile).add(u.wind).toVar();
    // (fleckSharpen's twin.)
    const [sFrom, sTo] = FLECK.sharpenLod;
    const climbK = clamp(float(sFrom).sub(lod).div(sFrom - sTo), 0.0, 1.0);
    const sharpen = mix(float(FLECK.sharpen[0]), float(FLECK.sharpen[1]), climbK);
    const at = max(lod.sub(sharpen), 0.0);
    let m = u.gap(st, at);
    if (mode === 'penumbra') m = m.mul(0.6).add(u.gap(st, max(at.sub(1.0), 0.0)).mul(0.4));
    const v = m.mul(exp2(lod.mul(FLECK.gain))).toVar();
    const thr = max(u.fleckThr, FLECK.least).toVar();
    // (In a pearly zone the vapour overhead blurs a fleck's rim: FLECK.pearlSoft.)
    const soft = u.pearl.mul(FLECK.pearlSoft).add(1.0).mul(FLECK.soft);
    const fl = max(smoothstep(thr, thr.mul(soft.add(1.0)), v), clamp(v.div(thr), 0.0, 1.0).mul(FLECK.dapple)).toVar();
    if (pools) {
        // A combo gap's pool: the gap's own pinhole image (its radius, blurred by the sun's disc),
        // drifting with the canopy.
        const pen = dC.mul(FLECK.disc).toVar();
        Loop({
            start: int(0), end: u.gapCount, type: 'int', condition: '<', name: 'gp',
        }, ({ gp }) => {
            const gap = u.events.element(gp.add(EVENT_ROWS.gaps));
            const d = length(q.sub(gap.xy.add(u.wind.mul(GAP_MASK.tile))));
            const rim = smoothstep(gap.z.sub(pen.mul(0.5)), gap.z.add(pen.mul(0.5)).add(1e-3), d);
            const pool = float(1.0).sub(rim).mul(gap.w);
            fl.assign(max(fl, pool.mul(FLECK.pools)));
        });
    }
    return fl;
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
 *                       inst: vec4 (code, group, seed, kRep), flute: vec2 (count, phase),
 *                       limb: vec2 (1 on a limb, how far into its melt into the leaves), optional }
 * @param {object} opts  { atlasSize, detail: striation and rim lift, fine: the torn edge and
 *                       the specular, canopyFade: metres below the canopy a trunk dissolves
 *                       into it over, billows: octaves of the mist top a foot sinks into,
 *                       lite: the canopy's Low and Minimal path }
 * @returns {object} vec3 node (scene-linear HDR, through the air)
 */
export function rbBark(u, at, {
    atlasSize = 512,
    detail = true,
    fine = true,
    canopyFade = CANOPY_SHADE,
    billows = 2,
    fleckLod = 'pixel',
    pools = false,
    lite = false,
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
    // Isotropic grain (BARK_ISO square tile, detail tiers): the worn bark's mottle (b, 10 cm cells),
    // its tiny pale flecks (a, 5 cm) and the broad ripple of its relief (g 40 cm, r 80 cm).
    const isoN = detail ? u.fbm(vec2(s.mul(TW / BARK_ISO), yM.div(BARK_ISO))).toVar() : null;

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
    const turn = pick4(vec4(...GROUP_CYCLE.turn)).toVar();
    const tR = tileOf(cRegion).toVar();
    const tO = tileOf(cOther).toVar();
    // Each ribbon's place in its tile's cycle (the palette's phase rows, four to a row), turned
    // by its group's GROUP_CYCLE.turn.
    const placeOf = (id) => {
        const k = max(id.sub(ATLAS_ISLANDS + 1), 0.0);
        const row = floor(k.add(0.5).div(4.0));
        const c = k.sub(row.mul(4.0));
        const r = u.palette.element(int(row).add(PALETTE_ROWS.phases));
        return mix(mix(r.x, r.y, step(0.5, c)), mix(r.z, r.w, step(2.5, c)), step(1.5, c)).add(turn);
    };
    const lifeR = rbPatchAge(vec3(region, tR.x, tR.y), seed, clock, bias, cycle, placeOf(region)).toVar();
    const lifeO = rbPatchAge(vec3(other, tO.x, tO.y), seed, clock, bias, cycle, placeOf(other)).toVar();
    const patchR = step(ATLAS_ISLANDS + 0.5, region).toVar();
    const patchO = step(ATLAS_ISLANDS + 0.5, other).toVar();
    const islandR = step(0.5, region).sub(patchR).toVar();
    const islandO = step(0.5, other).sub(patchO).toVar();
    // The matrix: old slate wandering a little; its islands a touch older (their lips lift over
    // it). (Its maroon comes only from real old patches: a soft weathering toward it read as a
    // stain among the crisp torn edges.)
    const matrixAge = float(MATRIX_AGE).add(coarseN.r.sub(0.5).mul(0.06)).toVar();
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
    // And its colour drifts a little across it (BARK_PATCH_VALUE.drift of age over the coarse
    // grain's broad band: an ember strip warms toward rust in places, a lime one toward olive).
    const driftAge = coarseN.g.sub(0.5).mul(BARK_PATCH_VALUE.drift).mul(float(1.0).sub(smoothstep(0.84, 0.9, aR)));
    const aLoc = clamp(aR.add(patchR.mul(inner.add(driftAge))), 0.0, 1.0).toVar();
    // The skin a pixel shows: the new one where it has been revealed, else the old (its
    // weathering, its light and its lips follow it, so nothing jumps at the wrap).
    const aSkin = mix(float(lastAge), aLoc, shown).toVar();

    // ── 4. Colour ──
    // The ambient bark at an age (barkAlbedo's twin): the ambient chroma (fresh bark nearer the
    // ramp's own), fresh bark dimmed in value only, the rare accents muted and a little darker.
    const { from: accentFrom, to: accentTo, ramp: accentRamp } = BARK_ACCENT;
    const barkOf = (age) => {
        const c = u.ramp(age);
        const accent = smoothstep(accentFrom - accentRamp, accentFrom, age)
            .sub(smoothstep(accentTo, accentTo + accentRamp, age));
        const young = float(1.0).sub(smoothstep(BARK_FRESH_DIM.from, BARK_FRESH_DIM.to, age));
        const fresh = young.mul(BARK_FRESH_DIM.k - 1).add(1.0);
        const k = fresh.mul(accent.mul(BARK_ACCENT.dim - 1).add(1.0)).mul(BARK_ALBEDO);
        const chroma = float(BARK_CHROMA).add(young.mul(BARK_FRESH_DIM.chroma - BARK_CHROMA))
            .sub(accent.mul(BARK_ACCENT.mute));
        return mix(vec3(rbLuma(c)), c, chroma).mul(k);
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
    const hR = hashOf(region, tR).toVar();
    const valueR = valueOf(patchR, islandR, hR).toVar();
    const col = mix(vec3(...barkAlbedo(lastAge)), barkOf(aLoc), shown).mul(valueR).toVar();
    const old = oldOf(aSkin).toVar();
    // Texture is allocated by age (the bark notes' #4): the slate matrix wears it fully, an old
    // patch BARK_WORN.patch of it, younger bark only a trace (BARK_PATCH_VALUE.grain).
    const worn = old.mul(patchR.mul(BARK_WORN.patch - 1).add(1.0)).toVar();
    const grainK = mix(float(BARK_PATCH_VALUE.grain), float(1.0), worn).toVar();
    col.mulAssign(weathered(old, patchR));
    if (isoN) {
        // The worn bark's mottle, both ways alike, and its tiny lighter flecks; on younger bark only
        // a very slight value noise (BARK_PATCH_VALUE.iso, the same cells).
        const motK = mix(float(BARK_PATCH_VALUE.iso), float(BARK_WORN.mottle), worn);
        const mot = isoN.b.sub(0.5).mul(motK).add(isoN.a.sub(0.5).mul(grainK.mul(BARK_WORN.mottleFine)));
        const specks = smoothstep(BARK_WORN.specks[0], BARK_WORN.specks[1], isoN.a).mul(BARK_WORN.speck);
        col.mulAssign(mot.add(specks.mul(worn)).mul(detailK).add(1.0));
    }
    // Inside a younger patch the value is never flat (BARK_PATCH_VALUE): fresher (lighter) toward
    // one end, its own way up or down the trunk, and toward one edge, and a low mottle across it;
    // its rim a touch fresher still.
    const P = BARK_PATCH_VALUE;
    const along = sin(yM.mul(P.wave).add(hR.mul(TAU_TSL))).mul(P.end);
    const across = sin(s.mul(P.acrossCycles * TAU_TSL).add(hR.mul(5.1))).mul(P.across);
    const mottle = coarseN.g.sub(0.5).mul(P.mottle).add(coarseN.r.sub(0.5).mul(P.mottle * 0.5));
    const rimLight = float(1.0).sub(smoothstep(0.0, P.rimWidth, dEdge)).mul(P.rim);
    col.mulAssign(patchR.mul(float(1.0).sub(worn)).mul(along.add(across).add(mottle).add(rimLight)).add(1.0));
    // Broad faint streaks along the grain, on worn bark (BARK_WORN.streaks).
    if (fineN) col.mulAssign(fineN.r.sub(0.5).mul(grainK.mul(BARK_WORN.streaks)).mul(detailK).add(1.0));
    // Striation (detail tiers): fine, faint and long (8 and 4 mm × 30 and 15 cm, filtered through
    // its mips); its ridges tilt the bark's normal too (below).
    const grainAt = (ds) => u.fbm(vec2(s.mul(18.0).add(ds), yM.div(9.6))).a;
    const grain = detail ? grainAt(0.0).toVar() : null;
    if (detail) {
        // In old bark a few fine cracks, which only close views draw (narrower than a pixel they
        // would only twinkle).
        const crackW = max(fwidth(fineN.a), 0.004);
        const crackK = worn.mul(float(1.0).sub(smoothstep(0.004, 0.01, footprint)));
        const crackDark = float(1.0).sub(smoothstep(crackW.negate().add(0.035), crackW.add(0.035), fineN.a));
        const crackPale = smoothstep(crackW.negate().add(0.94), crackW.add(0.94), fineN.a);
        const lines = grain.sub(0.5).mul(grainK.mul(BARK_WORN.lines))
            .add(crackPale.mul(0.05).sub(crackDark.mul(0.12)).mul(crackK));
        col.mulAssign(lines.mul(detailK).add(1.0));
    }
    // The bark across the edge, cheaply (its age, value and weathering): the pixel's other share.
    const colO = barkOf(aO).mul(valueOf(patchO, islandO, hashOf(other, tO))).mul(weathered(oldOf(aO), patchO));
    col.assign(mix(colO, col, cover));
    // A hairline seam on every edge.
    const fw = fwidth(dEdge).toVar();
    const seamW = 0.0025;
    const seam = rbBand(dEdge, float(seamW), fw).toVar();
    col.mulAssign(float(1.0).sub(seam.mul(0.55).mul(detailK)));
    // Where an old edge lifts (detail tiers): its lip, turned up to the light (it catches the sun
    // and the sky, below), and its shadow on the younger bark, a dark line that deepens to a crack
    // where the lip has curled furthest (the sun cannot reach into it either).
    const lipK = float(0.0).toVar();
    const shadowK = float(0.0).toVar();
    if (detail) {
        // A patch about to shed lifts all the way over its last seconds.
        const older = step(aO, aSkin);
        const curl = fineN.b.toVar();
        const build = clamp(float(1.0).sub(min(lifeR.z, lifeO.z).div(PATCH_BUILD)), 0.0, 1.0);
        const lift = max(smoothstep(0.8, 0.97, max(aSkin, aO)).mul(curl.mul(0.6).add(0.4)), build).toVar();
        const lipW = lift.mul(0.008).add(0.005 + seamW).toVar();
        const lip = rbBand(dEdge, lipW, fw).sub(seam).mul(older).mul(lift);
        // A lip narrower than a pixel and a half is not drawn (it would only be a hairline).
        const lipPx = smoothstep(1.0, 2.0, lipW.div(max(footprint, 1e-5)));
        lipK.assign(lip.mul(detailK).mul(detailK).mul(lipPx));
        col.mulAssign(lipK.mul(BARK_LIGHT.lip).add(1.0));
        const reach = lift.mul(0.02).add(0.008);
        const shadow = float(1.0).sub(smoothstep(0.0, reach, dEdge.sub(seamW)))
            .mul(float(1.0).sub(older)).mul(lift);
        const depth = smoothstep(0.6, 0.9, curl).mul(0.35).add(0.45);
        shadowK.assign(shadow.mul(depth).mul(detailK));
        col.mulAssign(float(1.0).sub(shadowK));
    }
    const mean = u.palette.element(int(group).add(PALETTE_ROWS.groupMean)).xyz;
    const albedo = mix(mean, col, detailK).toVar();

    // ── 6. Light ──
    const { P: Pw } = at;
    // The flutes tilt the normal round the trunk (∂r/∂θ over r); a slow irregular bulge too; and
    // on the detail tiers the worn bark's own relief (BARK_RELIEF): the striation's ridges (the
    // slope of their height round the trunk, from a second tap) and a broad ripple both ways
    // alike, so a fleck breaks up on the slate and lies whole on fresh satin.
    const around = vec3(sin(theta).negate(), 0.0, cos(theta));
    const fluteArg = at.flute.x.mul(theta).add(at.flute.y).add(yM.mul(TRUNK_FLUTE.twist));
    let slope = sin(fluteArg).mul(at.flute.x).mul(-TRUNK_FLUTE.amp).add(coarseN.g.sub(0.5).mul(0.12));
    let rise = float(0.0);
    let ridge = float(0.0);
    if (detail) {
        const R0 = BARK_RELIEF;
        const relief = detailK.mul(float(1.0).sub(shadowK));
        const rise0 = grainAt(R0.step / u.tex.fbm.image.width).sub(grain).mul(R0.grain);
        ridge = clamp(rise0, -R0.grainMax, R0.grainMax).mul(worn).mul(relief);
        const ripple = mix(float(R0.young), float(1.0), worn).mul(2 * R0.rippleMax).mul(relief);
        slope = slope.add(isoN.g.sub(0.5).mul(ripple));
        rise = isoN.r.sub(0.5).mul(ripple);
    }
    // The broad normal (flutes, bulge, ripple) takes the fill and the sheen; the striation's ridges
    // only break up the direct light (the flecks and their glints): in the diffuse light of the
    // shade, ridges a few millimetres wide would only draw bright hairlines out of the sheen.
    const N = normalize(at.N.sub(around.mul(slope)).add(vec3(0.0, rise, 0.0))).toVar();
    const V = normalize(cameraPosition.sub(Pw)).toVar();
    const L = u.sunDir;
    // (And only where the bark is well turned to the sun: toward the terminator a ridge's small
    // tilt is a large share of the light, and the striation would draw long bright hairlines.)
    const Nd = detail
        ? normalize(N.sub(around.mul(ridge.mul(smoothstep(BARK_RELIEF.lit[0], BARK_RELIEF.lit[1], dot(N, L)))))).toVar()
        : N;
    // A lifted lip faces up and out: it takes the light as if turned toward the sky.
    const ndlLip = max(dot(normalize(Nd.add(vec3(0.0, BARK_LIGHT.lipTurn, 0.0))), L), 0.0);
    const ndl = mix(max(dot(Nd, L), 0.0), ndlLip, lipK).mul(float(1.0).sub(shadowK)).toVar();
    // The canopy's light: sunflecks (rbFleck), melting into their mean where a pinhole's image
    // spans only a few pixels (far bark: a crawling fleck a pixel wide would only twinkle) and,
    // past the near trunks, with distance (BARK_LIGHT.fleckFar).
    const dist = length(cameraPosition.sub(Pw)).toVar();
    const near = exp(max(max(dist.sub(BARK_LIGHT.fleckFar[0]), 0.0).div(-BARK_LIGHT.fleckFar[1]), -30.0)).toVar();
    const penPx = max(u.canopyY.sub(Pw.y), 0.0).div(max(L.y, 0.2)).mul(FLECK.disc).div(max(footprint, 1e-4));
    const sharp = smoothstep(BARK_LIGHT.fleckPx[0], BARK_LIGHT.fleckPx[1], penPx).mul(near).toVar();
    const fl = float(0.0).toVar();
    If(sharp.greaterThan(0.001), () => {
        fl.assign(rbFleck(u, Pw, { lod: fleckLod, pools }));
    });
    // How much of this is a fleck's body (its gain, BARK_LIGHT.fleck, is the flecks' own: never the
    // dapple between them, nor their mean where they melt).
    const body = smoothstep(BARK_LIGHT.fleckBody[0], BARK_LIGHT.fleckBody[1], fl).toVar();
    // The sun's side never falls dark between flecks (BARK_LIGHT.sunFloor).
    const F0 = BARK_LIGHT.sunFloor;
    const floorK = mix(float(F0.k[0]), float(F0.k[1]), smoothstep(F0.dist[0], F0.dist[1], dist))
        .mul(smoothstep(F0.ndl[0], F0.ndl[1], ndl));
    // Toward the terminator a fleck would be drawn out into a bar: there its contrast melts into the
    // mean (BARK_LIGHT.graze); only bark turned to the sun shows whole flecks.
    const square = smoothstep(BARK_LIGHT.terminator * 0.4, BARK_LIGHT.terminator * BARK_LIGHT.graze, ndl);
    body.mulAssign(sharp.mul(square));
    fl.assign(mix(u.fleckMean, fl, sharp.mul(square)).mul(u.fleckLight));
    const glow = max(u.fleckMean.mul(floorK).mul(u.fleckLight).sub(fl), 0.0);
    // The sun's light, cream-gold; on old slate richer still (BARK_LIGHT.slateSun).
    const sun = mix(u.sunCol, vec3(rbLuma(u.sunCol)), old.mul(-BARK_LIGHT.slateSun)).toVar();
    // (Faded in over the terminator: a fleck stretched along a grazing surface would draw a bar.)
    const ndlSun = ndl.mul(smoothstep(0.0, BARK_LIGHT.terminator, ndl)).toVar();
    const glowCol = mix(vec3(rbLuma(u.sunCol)), u.sunCol, F0.warm);
    // (The soft, broad pinhole images of the low storeys take it; up in the Limb Storey the small
    // crisp flecks are bright enough as they are, and gained they would run together.)
    const lowFlecks = smoothstep(FLECK.sharpenLod[1], FLECK.sharpenLod[0], u.fleckLod);
    const fleckGain = mix(float(BARK_LIGHT.fleck[0]), float(BARK_LIGHT.fleck[1]), old);
    const fleckK = mix(float(1.0), fleckGain, body.mul(lowFlecks));
    const direct = sun.mul(fl.mul(fleckK)).add(glowCol.mul(glow)).mul(ndlSun);
    // Fill (§2.4): the sky through the canopy from above, cool (thinner below the eye, cooler over
    // it: rbSkyFill), less blue on young bark so its colours survive the shade; and the broad,
    // warm light of the bright forward-scattering haze on the sun's side, reaching round past the
    // terminator, so the lit side of a trunk reads against its shade side even between flecks.
    const young = float(1.0).sub(old).toVar();
    const groove = smoothstep(0.3, 1.0, cos(fluteArg).negate()).mul(BARK_LIGHT.groove);
    const ao = smoothstep(0.0, 0.05, dEdge).mul(0.15).add(0.85).mul(float(1.0).sub(groove));
    const sunSide = dot(N.xz, normalize(L.xz)).mul(0.5).add(0.5).toVar();
    const shadeAtSky = u.col.hazeShade.mul(rbLuma(u.col.sky).div(max(rbLuma(u.col.hazeShade), 1e-4)));
    const skyBlue = mix(u.col.sky, shadeAtSky, mix(float(BARK_LIGHT.blue), float(BARK_LIGHT.slateBlue), old));
    const skyCol = skyBlue.mul(rbSkyFill(u, Pw.y));
    const open = mix(float(BARK_LIGHT.skyOpen[0]), float(1.0), smoothstep(0.0, BARK_LIGHT.skyOpen[1], sunSide));
    const skyFill = mix(skyCol, vec3(rbLuma(skyCol)), young.mul(BARK_LIGHT.youngSky))
        .mul(N.y.mul(0.2).add(BARK_LIGHT.sky)).mul(open);
    const inHaze = smoothstep(AIR_CLEAR * BARK_LIGHT.hazeNear[0], AIR_CLEAR * BARK_LIGHT.hazeNear[1], dist).toVar();
    const hazeFrom = mix(float(BARK_LIGHT.hazeFrom[0]), float(BARK_LIGHT.hazeFrom[1]), inHaze);
    const hazeFill = u.col.hazeSun.mul(smoothstep(hazeFrom, 1.0, sunSide))
        .mul(mix(float(BARK_LIGHT.haze[0]), float(BARK_LIGHT.haze[1]), inHaze));
    const ambient = skyFill.add(hazeFill).mul(ao);
    // Bounce (§2.4): warm light up from the mist top, fading with height above it, strongest on
    // bark that faces down toward it, and (BOUNCE) on the shade side below the eye.
    const facing = max(float(0.3).sub(N.y), 0.0).mul(0.55).add(0.45);
    const away = float(1.0).sub(smoothstep(0.3, 0.7, sunSide));
    const below = rbBelowEye(u, Pw.y);
    const nearBelow = float(1.0).sub(smoothstep(BARK_LIGHT.footNear[0], BARK_LIGHT.footNear[1], dist));
    const shadeBelow = away.mul(below).mul(below).mul(nearBelow).toVar();
    const bounceK = mix(float(BARK_LIGHT.bounce[0]), float(BARK_LIGHT.bounce[1]), shadeBelow);
    const bounce = rbBounce(u, Pw.y, facing, away).mul(bounceK);
    // In the shade coloured bark keeps its colour: the indirect light lifts its chroma.
    const vivid = float(1.0).sub(smoothstep(BARK_LIGHT.vividTo[0], BARK_LIGHT.vividTo[1], aSkin));
    const rich = mix(vec3(rbLuma(albedo)), albedo, vivid.mul(BARK_LIGHT.shadeChroma).add(1.0));
    const rough = mix(0.25, 0.75, smoothstep(0.1, 0.9, aSkin)).toVar();
    // (The cosine is held off zero: on a coarse grid the interpolated normal grazes at the very
    // silhouette before the facet does, and an unbounded Fresnel there dots the outline with sky.)
    const F = rbSchlick(max(dot(N, V), 0.15), float(BARK_SHEEN.f0)).toVar();
    // The wet satin sheen: what the bark mirrors, the blue air, bright and cream toward the sun
    // (the haze's forward scatter), a reflection that looks down seeing the mist's luminous top;
    // a strip down the sun's side (the Elder's card-facing face mirrors the bright air on the
    // right), and on the shade side only BARK_SHEEN.shade of it.
    const Rv = reflect(V.negate(), N).toVar();
    const forward = rbHgMix(dot(Rv, L), float(0.6));
    const air = mix(u.col.hazeShade, u.col.hazeSun, clamp(dot(Rv, L).mul(0.5).add(0.5), 0.0, 1.0))
        .mul(forward.mul(BARK_SHEEN.glow).add(1.0));
    const floorGlow = mix(u.col.mistTop, u.col.underglow, 0.5).mul(SHEEN_FLOOR);
    const sky = mix(air, floorGlow, smoothstep(0.0, -0.45, Rv.y).mul(float(1.0).sub(rbMistInside(u))));
    const strip = mix(float(BARK_SHEEN.shade), float(1.0), smoothstep(0.3, 0.85, sunSide));
    const sheenRaw = sky.mul(F.mul(u.sheenK).mul(float(1.0).sub(rough)).mul(strip).mul(BARK_SHEEN.k))
        .mul(max(float(1.0).sub(fl.mul(smoothstep(0.0, 0.15, ndl)).mul(BARK_SHEEN.fleck)), 0.0))
        .mul(near.mul(0.6).add(0.4))
        .toVar();
    const sheen = sheenRaw.mul(min(float(1.0), float(BARK_SHEEN.most).div(max(rbMax3(sheenRaw), 1e-4))));
    // (The floor's glaze is the near satin's: on a far trunk, a pixel of mean bark, it fades.)
    const glazeK = mix(float(BARK_LIGHT.glaze[0]), float(BARK_LIGHT.glaze[1]), shadeBelow);
    const glaze = rbGlaze(u, Pw.y, away).mul(detailK.mul(0.75).add(0.25)).mul(glazeK);
    // (A fleck and its glints never burn the bark's colour out: their light rolled off on its
    // brightest channel, hue kept, FLECK_SHOULDER; in a pearly zone the mist above takes a share.)
    // (Low-chroma bark, slate and husk, takes the sun's gold in its light: FLECK_SHOULDER.gold.)
    const aMax = rbMax3(albedo);
    const aChroma = aMax.sub(min(albedo.x, min(albedo.y, albedo.z))).div(max(aMax, 1e-3));
    const goldK = float(1.0).sub(aChroma).mul(FLECK_SHOULDER.gold);
    const sunAlbedo = mix(albedo, vec3(...FLECK_GOLD_HUE).mul(rbLuma(albedo)), goldK);
    let sunTerm = sunAlbedo.mul(direct);
    if (fine) {
        // The wet bark's specular (GGX-lite × Schlick, as products): the sun's glints in the flecks.
        const H = normalize(L.add(V));
        const ndh = max(dot(Nd, H), 0.0);
        const a2 = rough.mul(rough).mul(rough).mul(rough);
        const dd = ndh.mul(ndh).mul(a2.sub(1.0)).add(1.0);
        const D = a2.div(dd.mul(dd).mul(Math.PI).add(1e-4));
        sunTerm = sunTerm.add(sun.mul(fl.mul(ndlSun).mul(min(D, BARK_SHEEN.glintMax)).mul(F).mul(BARK_SHEEN.glint)));
    }
    const veiledSun = float(1.0).sub(u.pearl.mul(FLECK_SHOULDER.pearl));
    const sunlitBark = rbRollOff(sunTerm.mul(veiledSun), {
        knee: float(FLECK_SHOULDER.knee).div(u.exposure),
        peak: float(FLECK_SHOULDER.peak).div(u.exposure),
    });
    const lit = sunlitBark.add(rich.mul(ambient.add(bounce))).add(sheen)
        .add(glaze)
        .toVar();
    // Down in the mist it has lost its sun, its sky and its bounce to the vapour's light (rbDrown).
    lit.assign(mix(lit, albedo.mul(u.col.mistTop).mul(MIST_DROWN_LIGHT), rbDrown(u, Pw.y)));
    // Up under the canopy the bark stands in the crowns' shade… (over a band that shrinks as the eye
    // nears the canopy, CANOPY_FADE_NEAR: seen from just under it, a long band would leave the
    // trunks' whole upper length a pale pole of leaves)
    const band = clamp(u.canopyY.sub(u.camPos.y).div(CANOPY_FADE_NEAR.ref), CANOPY_FADE_NEAR.least, 1.0)
        .mul(canopyFade)
        .mul(rbMistInside(u).mul(CANOPY_FADE_NEAR.mist - 1).add(1.0))
        .toVar();
    const shadeFrom = u.canopyY.sub(max(band.mul(2.0), CANOPY_TOP.shade));
    lit.mulAssign(float(1.0).sub(smoothstep(shadeFrom, u.canopyY, Pw.y).mul(0.5)));
    // (A limb up in the crowns, deeper in their shade: a dark line, LIMB_SHADE.)
    const limbAt = at.limb || null;
    if (limbAt) {
        const shaded = limbAt.x.mul(smoothstep(u.canopyY.sub(LIMB_SHADE.from), u.canopyY.sub(LIMB_SHADE.to), Pw.y));
        const grey = vec3(rbLuma(lit));
        lit.assign(mix(lit, mix(grey, lit, LIMB_SHADE.chroma).mul(LIMB_SHADE.light), shaded));
    }
    const seen = rbAir(u, lit, Pw, null, { billows }).toVar();
    if (u.lace) {
        // …and over its last metres it dissolves into the canopy the backdrop paints along this very
        // ray (a limb over the last of its length too, LIMB_INTO): into the crowns' leaves, then over
        // the last of its tube into the canopy openings and all (CANOPY_TOP), so a trunk or a limb
        // enters the lace without a line and its tube ends in the pixel painted round it.
        const nearTop = smoothstep(u.canopyY.sub(band), u.canopyY.sub(0.5), Pw.y);
        const into = (limbAt ? max(nearTop, limbAt.y) : nearTop).toVar();
        // (The openings come in over the whole band, so a tube against a gap fades toward the gap's
        // own light, never into a column of leaves standing in front of the sky.)
        const topK = smoothstep(u.canopyY.sub(band), u.canopyY.sub(0.05), Pw.y);
        const solid = float(1.0).sub(limbAt ? max(topK, limbAt.y) : topK).toVar();
        const ray = Pw.sub(cameraPosition).normalize().toVar();
        If(into.greaterThan(0.001), () => {
            seen.assign(mix(seen, rbCanopy(u, ray, null, { solid, lite }), into));
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
    const format = [null, THREE.RedFormat, THREE.RGFormat, null, THREE.RGBAFormat][channels] || THREE.RGBAFormat;
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

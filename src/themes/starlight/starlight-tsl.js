/**
 * Starlight — shared TSL: the uniforms every part reads, the baked noise, the sky's frames, the
 * far hills and the water.
 *
 * One set of uniforms (createUniforms) is the scene's state on the GPU: the sky's angle round the
 * pole, how far the shutter is open, the light of the hour, and the small tables the gameplay
 * writes (streaks in the air, rings on the water, the figures' light). Parts never keep copies:
 * the world writes, the materials read.
 *
 * Everything in the sky is drawn at one radius round the lens, so a thing is a DIRECTION. The
 * water repeats the sky: mirrorDir() turns a direction into where the lake shows it, bent by the
 * same slopes (waterSlope) the sky's own mirror ray reads, so a star and its reflection in the
 * Milky Way's reflection stay together.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    log2,
    max,
    mix,
    normalize,
    pow,
    sin,
    smoothstep,
    step,
    texture,
    uniform,
    uniformArray,
    vec2,
    vec3,
} from 'three/tsl';
import {
    FIGURES_KEPT, NOISE_SIZE, TAU, WORLD, bakeNoise,
} from './starlight-core.js';

/** vec2 → [0,1) */
export const slHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'sl_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

export const slLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
export const slMax3 = (c) => max(c.x, max(c.y, c.z));
/** e^(−x²). */
export const slGauss = (x) => exp(x.mul(x).negate());

// ── The noise texture ────────────────────────────────────────────────────────────

/** The baked noise as a repeating texture; `data` is bakeNoise()'s (the world keeps it too). */
export function createNoiseTexture(data = bakeNoise()) {
    const tex = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
}

/** Sample the noise at an explicit level (vertex stage, or where an angle wraps). */
export const noiseAt = (tex, uvNode, level = 0) => texture(tex, uvNode).level(level);

/**
 * The noise at a whole mip `level`, with the texel's bilinear weights eased (quintic): a read that
 * is sharpened afterwards (the dust's edges, its threads) then draws curves, not the facets of a
 * magnified texel grid. One fetch; starlight-core.js sampleNoiseSmooth() is the CPU's copy.
 */
export const noiseSmooth = (tex, uvNode, level = 0) => {
    const size = NOISE_SIZE / 2 ** level;
    const p = uvNode.mul(size).add(0.5);
    const i = floor(p);
    const f = fract(p);
    const e = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0));
    return texture(tex, i.add(e).sub(0.5).div(size)).level(level);
};

// ── The scene's state ────────────────────────────────────────────────────────────

/**
 * Streaks in the air at once: shooting stars, a fireball and its train and its pieces, the motes
 * of locks, the satellites drifting over. A perfect clear's storm, a great clear's fireball, a
 * lock's mote and the satellites all fit at once.
 */
export const STREAKS = 48;
/** Rings on the water at once. */
export const RINGS = 6;

const rows = (count) => Array.from({ length: count }, () => new THREE.Vector4(0, 0, 0, 0));
const colour = (r, g, b) => uniform(new THREE.Vector3(r, g, b));

export function createUniforms() {
    const tables = {
        // per streak: (from xyz, start time) + (to xyz, duration) + (rgb, power)
        //           + (kind, tail length as a share of the path, width in pixels, bow)
        streaks: rows(STREAKS * 4),
        // per ring: (x, z, radius, strength) + (rgb, width)
        rings: rows(RINGS * 2),
        // per kept figure: (light 0..1, flare, 0, 0); the last row is the catalogue's own glints
        figures: rows(FIGURES_KEPT + 1),
        // per twist's spiral (starlight-spiral.js): (unit world direction, start) + (sense, radius, power, 0)
        spirals: rows(4),
    };
    return {
        tables,
        streaks: uniformArray(tables.streaks, 'vec4'),
        rings: uniformArray(tables.rings, 'vec4'),
        figures: uniformArray(tables.figures, 'vec4'),
        spirals: uniformArray(tables.spirals, 'vec4'),

        time: uniform(0),
        /** The sky's turn round the pole, radians: accumulated, so a change of pace never jumps. */
        skyAngle: uniform(0),
        /** The trail every star draws behind it, radians round the pole. */
        exposure: uniform(0),
        /** The chain: 0 at rest, toward 1. */
        shutter: uniform(0),
        /** The Milky Way swelling on a great clear, 0..1. */
        surge: uniform(0),
        /**
         * How hot play runs (src/themes/shared/gameplay-surge.js): `heat` the level, `fever` the
         * slow tide. The trails turn to their stars' own colours and the faint ones thin out, so
         * a fever's sky is drawn in vivid arcs on a dark night instead of a grey veil.
         */
        heat: uniform(0),
        fever: uniform(0),
        /** How far a figure's lines take the colours of the stars they join (0: the hour's line). */
        tint: uniform(0),
        /** How still the lake lies: 1 its own swell, less in a fever (the mirror goes glassy). */
        still: uniform(1),
        /** Two fireballs' light: (where each is, unit world direction; power), and their colour. */
        flash: uniform(new THREE.Vector4(0, 1, 0, 0)),
        flashB: uniform(new THREE.Vector4(0, 1, 0, 0)),
        bolide: colour(0.7, 1.0, 0.9),

        /** The pole and the two unit vectors across it (starlight-core.js poleFrame). */
        pole: uniform(new THREE.Vector3(0, 0.42, -0.9)),
        poleUp: uniform(new THREE.Vector3(0, 0.9, 0.42)),
        poleWest: uniform(new THREE.Vector3(-1, 0, 0)),

        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        /**
         * Sizes are authored in pixels of a 1080-line frame, so a star covers the same share of
         * the sky on a phone's small buffer as on a 4K screen: `design` is the angle of one such
         * pixel, `texel` the angle of one pixel of the buffer really drawn (see sized()).
         */
        design: uniform(0.001),
        texel: uniform(0.001),

        zenith: colour(0.0035, 0.0055, 0.016),
        mid: colour(0.007, 0.011, 0.03),
        horizon: colour(0.034, 0.052, 0.105),
        airglow: colour(0.012, 0.04, 0.034),
        band: colour(0.62, 0.7, 1.0),
        core: colour(1.0, 0.8, 0.56),
        nebula: colour(1.0, 0.24, 0.42),
        water: colour(0.003, 0.006, 0.014),
        ridge: colour(0.004, 0.006, 0.013),
        line: colour(0.56, 0.74, 1.0),
        meteor: colour(0.7, 1.0, 0.9),
        bandPower: uniform(1),
        starPower: uniform(1),
        glowHeight: uniform(0.11),
        zodiac: uniform(0.18),
        dusk: uniform(0),

        /**
         * The night's air (starlight-night.js): (airglow waves, high veil, mist, breeze), each
         * 0..1, and the noctilucent shine. Each weather's terms sit behind a branch on its own
         * weight, the same for every pixel, so a clear night pays nothing for them.
         */
        air: uniform(new THREE.Vector4(0, 0, 0, 0)),
        shine: uniform(0),
        /**
         * A level-up's front of airglow rolling up the sky: (height it has reached, as the sine of
         * the altitude; its depth; its strength; 0).
         */
        front: uniform(new THREE.Vector4(-1, 0.1, 0, 0)),
        /**
         * The great comet (starlight-comet.js): its head (unit world direction; how bright it
         * is), its tail's axis at the head (away from the sun; the tail's length in radians), the
         * side its dust tail bends to (unit; an outburst 0..1).
         */
        comet: uniform(new THREE.Vector4(0, 0.2, -1, 0)),
        cometTail: uniform(new THREE.Vector4(0, 1, 0, 0.3)),
        cometSide: uniform(new THREE.Vector4(-1, 0, 0, 0)),
    };
}

// ── The high veil ────────────────────────────────────────────────────────────────

/**
 * The way the high wind blows the veil's fibres (a unit vector in world x, z): mostly away from
 * the lens, so the streets of cirrus run along the line of sight and fan out from a point on the
 * horizon. (Blown across the view they lie in the frame as parallel stripes: venetian blinds.)
 */
const VEIL_WIND = Object.freeze([0.34, -0.94]);

/**
 * The high veil of cirrus in direction `d`: 0 clear … ~1 thick. A deck a few kilometres up, seen
 * from below (so its streets converge toward the horizon); two layers of fibres, stretched about
 * four to one along the wind and moving at two speeds, gathered into clumps by a third slow read,
 * so the veil forms, stretches and melts as it goes instead of sliding past as one painted sheet.
 * `level` is the noise's mip (an explicit one in a vertex). Thinned to nothing toward the
 * horizon, where the deck's fibres would crowd below a pixel.
 */
export const veilDensity = (u, noise, d, level = null) => {
    const up = max(d.y, 0.0);
    const q = d.xz.div(up.add(0.05));
    const along = q.x.mul(VEIL_WIND[0]).add(q.y.mul(VEIL_WIND[1]));
    const across = q.y.mul(VEIL_WIND[0]).sub(q.x.mul(VEIL_WIND[1]));
    const t = u.time;
    const lv = level ?? 0;
    // A fragment reads its finest layer with the texture's own mip choice; everything else at a
    // given level.
    const read = (uvNode, at) => (level === null && at === 0
        ? texture(noise, uvNode)
        : texture(noise, uvNode).level(at));
    const warp = read(vec2(along.mul(0.018).add(t.mul(0.0004)), across.mul(0.05).add(0.61)), lv + 2).b;
    const a = read(vec2(along.mul(0.07).sub(t.mul(0.0052)).add(warp.mul(0.3)), across.mul(0.28).add(0.13)), lv).g;
    const bAt = vec2(along.mul(0.11).sub(t.mul(0.0088)).add(0.37), across.mul(0.42).add(warp.mul(0.4)).add(0.21));
    const b = read(bAt, lv).r;
    const clump = read(vec2(along.mul(0.024).sub(t.mul(0.0031)).add(0.5), across.mul(0.07).add(0.9)), lv + 2).g;
    const cover = u.air.y;
    const fibres = a.mul(0.55).add(b.mul(0.45)).add(smoothstep(0.3, 0.72, clump).mul(0.3)).sub(0.12);
    return smoothstep(cover.mul(-0.3).add(0.62), cover.mul(-0.12).add(0.9), fibres)
        .mul(smoothstep(0.012, 0.09, up)).mul(cover);
};

// ── The sky's frames ─────────────────────────────────────────────────────────────

/**
 * An angle for something `pixels` wide on a 1080-line frame, never thinner than `least` pixels
 * of the buffer really drawn (a thing thinner than a pixel crawls as the sky turns).
 */
export const sized = (u, pixels, least) => max(u.design.mul(pixels), u.texel.mul(least));

/** A sky direction (cos ρ, sin ρ, angle round the pole) → its unit world direction. */
export const skyDir = (u, cosRho, sinRho, angle) => u.pole.mul(cosRho)
    .add(u.poleUp.mul(cos(angle)).add(u.poleWest.mul(sin(angle))).mul(sinRho));

/** The direction a sky direction is moving in as the sky turns (unit, across the pole). */
export const skyTangent = (u, angle) => u.poleWest.mul(cos(angle)).sub(u.poleUp.mul(sin(angle)));

/** A star's colour from its temperature: 0 ember … 0.5 white … 1 blue. */
export const starColour = (temp) => {
    const ember = vec3(1.0, 0.5, 0.26);
    const gold = vec3(1.0, 0.8, 0.52);
    const white = vec3(1.0, 0.96, 0.92);
    const blue = vec3(0.6, 0.74, 1.0);
    const warm = mix(ember, gold, smoothstep(0.0, 0.26, temp));
    const cool = mix(white, blue, smoothstep(0.55, 1.0, temp));
    return mix(warm, cool, smoothstep(0.24, 0.56, temp));
};

// ── The far hills ────────────────────────────────────────────────────────────────

/**
 * The hills on the horizon in a world direction: (near crest, far crest, the distant range), as
 * heights in the direction's own y (the sine of the altitude). Read at an explicit level, so it is
 * the same in a vertex and in a fragment and has no seam where the azimuth wraps.
 *
 * The distant range stands behind both crests in stretches: peaks with sharp shoulders (a fold of
 * the noise read twice as fast as the hills', and a finer one for its edges), so the horizon has
 * three depths, the farthest the palest.
 */
export const ridges = (noise, d) => {
    const ua = atan(d.x, d.z.negate()).div(TAU);
    const far = noiseAt(noise, vec2(ua.mul(3.0).add(0.13), 0.21)).r;
    const farFine = noiseAt(noise, vec2(ua.mul(19.0), 0.77)).g;
    const near = noiseAt(noise, vec2(ua.mul(5.0).add(0.61), 0.52)).g;
    const nearFine = noiseAt(noise, vec2(ua.mul(41.0), 0.34)).b;
    const farCrest = pow(max(far.sub(0.22), 0.0), 1.6).mul(0.11).add(farFine.mul(0.007)).add(0.006);
    const nearCrest = pow(max(near.sub(0.34), 0.0), 1.9).mul(0.085).add(nearFine.mul(0.0045)).add(0.0025);
    // The range: a fold of a read nine tiles round (round tops become peaks), in stretches.
    const range = noiseAt(noise, vec2(ua.mul(9.0).add(0.43), 0.58)).r;
    const rangeFine = noiseAt(noise, vec2(ua.mul(23.0).add(0.2), 0.11), 1).r;
    const stretch = smoothstep(0.36, 0.6, noiseAt(noise, vec2(ua.mul(2.0).add(0.77), 0.66)).g);
    const peaks = abs(range.mul(2.0).sub(1.0)).oneMinus();
    // Less a base, so the lowest folds sink behind the hills instead of standing as needles.
    const rangeCrest = max(pow(peaks, 2.0).mul(0.088).sub(0.012).add(rangeFine.mul(0.0045)), 0.0)
        .mul(stretch).add(0.004);
    return vec3(nearCrest, farCrest, rangeCrest);
};

// ── The woods on the near shore ──────────────────────────────────────────────────

/** The tallest spruce on the near crest, radians of altitude, and the cells they stand in. */
export const WOODS_TREE = 0.0092;
const WOODS_CELL = 0.0036;

/** Where the woods stand along the near crest, by azimuth (turns): 0 bare … 1 wooded. */
export const woodsShare = (noise, ua) => smoothstep(0.44, 0.6, noiseAt(noise, vec2(ua.mul(6.0).add(0.37), 0.91), 1).g);

/** How high the woods stand over the near crest in a direction, on average: the stars set behind it. */
export const woodsTop = (noise, d) => woodsShare(noise, atan(d.x, d.z.negate()).div(TAU)).mul(WOODS_TREE * 0.62);

/**
 * The woods' silhouette in direction `d` (azimuth `az`): 1 inside a tree, 0 in the air. Spruce
 * stand on the near crest (`base`, as a height in d.y) in stretches, one a cell of azimuth, each a
 * narrow cone with its tiers of branches; edges anti-aliased over `fuzz` radians.
 */
export const woods = (noise, d, az, base, fuzz) => {
    const stand = woodsShare(noise, az.div(TAU));
    const id = floor(az.div(WOODS_CELL));
    let inside = float(0.0);
    for (let k = -1; k <= 1; k += 1) {
        const cell = id.add(k);
        const h1 = slHash21(vec2(cell, 7.1));
        const h2 = slHash21(vec2(cell, 3.7));
        const h3 = slHash21(vec2(cell, 9.3));
        const tall = h1.mul(h1).mul(0.65).add(0.35).mul(stand)
            .mul(WOODS_TREE);
        const cx = cell.add(0.5).add(h2.sub(0.5).mul(0.7)).mul(WOODS_CELL);
        const rise = d.y.sub(base).div(max(tall, 1e-6));
        const tiers = fract(rise.mul(4.0).add(h3)).mul(0.34).add(0.66);
        // Negative above the tip (never clamped to 0, which leaves a pixel-wide line up the sky).
        const half = rise.oneMinus().mul(WOODS_CELL * 0.6).mul(tiers);
        const edge = smoothstep(fuzz, fuzz.negate(), abs(az.sub(cx)).sub(half));
        inside = max(inside, edge.mul(step(0.0, rise)).mul(step(1e-5, tall)));
    }
    return inside;
};

// ── The water ────────────────────────────────────────────────────────────────────

/**
 * The lake's slope at a point (world x, z in metres): a long slow swell, patches of fine ripple
 * where a breath of wind touches it, and the rings the board sends out. Small on purpose: the
 * lake is a mirror.
 */
export const waterSlope = (u, noise, p, tier) => {
    const t = u.time;
    const swell = vec2(0.94, 0.34).mul(cos(dot(p, vec2(0.94, 0.34)).mul(0.62).add(t.mul(0.42))).mul(0.0009))
        .add(vec2(-0.5, 0.87).mul(cos(dot(p, vec2(-0.5, 0.87)).mul(1.05).sub(t.mul(0.55))).mul(0.0007)))
        .add(vec2(0.2, -0.98).mul(cos(dot(p, vec2(0.2, -0.98)).mul(1.9).add(t.mul(0.8))).mul(0.0005)));
    // A fever stills the lake: the swell and the cat's paws lie down, the rings still run. A
    // breeze (the air's) lifts the swell and spreads the paws until the mirror shivers.
    const breeze = u.air.w;
    let slope = swell.mul(u.still).mul(breeze.mul(1.6).add(1.0));
    if (tier.ripples) {
        // Cat's paws: where the coarse read is high, a fine read roughens the mirror.
        const far = length(p);
        // (Their drift keeps one speed: the clock times a speed the breeze changes would race
        // the pattern by t · dv while the air melts, more the longer the night has run.)
        const paws = smoothstep(
            breeze.mul(-0.3).add(0.52),
            breeze.mul(-0.16).add(0.8),
            noiseAt(noise, p.div(95.0).add(vec2(t.mul(0.004), 0.0)), 1.0).r,
        );
        // Read softer with distance: far ripples are smaller than a pixel and would only crawl.
        const level = clamp(log2(max(far, 1.0).div(14.0)), 0.0, 6.0);
        const fine = noiseAt(noise, p.div(vec2(5.5, 9.0)).add(vec2(t.mul(0.021), t.mul(0.013))), level);
        const grain = vec2(fine.b.sub(0.5), fine.a.sub(0.5));
        slope = slope.add(grain.mul(paws.mul(0.011).add(0.0012)).mul(exp(far.div(-160.0)).mul(0.9).add(0.1))
            .mul(u.still).mul(breeze.mul(0.7).add(1.0)));
    }
    for (let i = 0; i < RINGS; i += 1) {
        const ring = u.rings.element(i * 2);
        const paint = u.rings.element(i * 2 + 1);
        const away = p.sub(ring.xy);
        const r = max(length(away), 1e-3);
        const x = r.sub(ring.z).div(max(paint.w, 1e-3));
        // A short train of ripples: a few crests inside one swell.
        const wave = sin(x.mul(2.4)).mul(exp(x.mul(x).mul(-0.4))).mul(ring.w);
        slope = slope.add(away.div(r).mul(wave).mul(0.02));
    }
    return slope;
};

/** The light riding the rings at a water point: each ring's crest in its piece's colour. */
export const ringLight = (u, p) => {
    let light = vec3(0.0, 0.0, 0.0);
    for (let i = 0; i < RINGS; i += 1) {
        const ring = u.rings.element(i * 2);
        const paint = u.rings.element(i * 2 + 1);
        const r = length(p.sub(ring.xy));
        const x = r.sub(ring.z).div(max(paint.w, 1e-3));
        const crest = max(cos(x.mul(2.4)), 0.0);
        light = light.add(paint.xyz.mul(crest.mul(crest)).mul(exp(x.mul(x).mul(-0.4))).mul(ring.w));
    }
    return light;
};

/** Where a ray from the lens going down in direction `d` (d.y < 0) meets the water: world (x, z). */
export const waterPoint = (eye, d) => eye.xz.add(d.xz.mul(eye.y.div(max(d.y.negate(), 1e-4))));

/**
 * Where the lake shows a sky direction `d` (d.y > 0): the mirrored direction, bent by the water's
 * slope at the point the mirrored ray meets it. The slope along the line of sight moves the
 * image up and down (twice the slope), the slope across it sideways (far less, at a grazing
 * angle).
 */
export const mirrorDir = (u, noise, eye, d, tier) => {
    const flat = vec3(d.x, d.y.negate(), d.z);
    const slope = waterSlope(u, noise, waterPoint(eye, flat), tier);
    const along = dot(slope, normalize(d.xz.add(vec2(1e-5, 0.0))));
    return vec3(
        flat.x.add(slope.x.mul(d.y).mul(2.0)),
        flat.y.add(along.mul(2.0)),
        flat.z.add(slope.y.mul(d.y).mul(2.0)),
    );
};

/**
 * How much of the sky the water gives back at a downward direction: nearly all at a glance, less
 * as the eye looks down into it (the frame's foot shows the lake's own dark).
 */
export const mirrorShare = (d) => mix(0.44, 0.95, exp(abs(d.y).mul(-7.0)));

/** The sky's own radius, for the parts. */
export const SKY_RADIUS = WORLD.skyRadius;

export const clamp01 = (x) => clamp(x, 0.0, 1.0);
export { float };

/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children — Irisfall: shared TSL. The whole distance as ONE function of a direction.
 *
 * The sun is BEHIND the eye. Ahead is the other half of the sky: deep cobalt overhead, darkest in
 * the band ninety degrees from the sun, paling to an aqua-pearl haze on the far horizon; cirrus
 * combed along the wind, a receding altocumulus deck, far banks breaking the horizon, the shadows of
 * clouds behind us fanning out of A; a storm wall far off behind the bow's leg, its dark body and
 * rain the dark the bow burns against. Under the horizon there is no ground: the Deep, a bottomless
 * luminous haze with ragged mist shelves kilometres down, the isles' shadows lying across them as
 * wedges converging on the antisolar point A, where the opposition glow brightens the mist and, when
 * the board earns it, the glory opens.
 *
 * Every droplet optic reads ONE baked table (sky-children-core.js bakeOpticsLut): the primary and
 * secondary bows, the fogbow, the glory with the opposition glow. The bow is a circle round A; the
 * chain paints it stroke by stroke (U.strokes), so the sky function carries the stroke masks too.
 *
 * `skyColour(dir, U, tex, o)` is the dome; the pools call it again on their mirror ray with fewer
 * layers; stone fades into `horizonHaze`; spray multiplies `opticsAt` by its own density.
 *
 * These builders read uniforms and textures, so they are inline (called inside a material's Fn),
 * never laid-out functions. Only the pure helpers carry setLayout.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, abs, acos, atan, clamp, cos, dot, exp, float, floor, fract, fwidth, length, log2, max, min, mix, normalize,
    select, sin, smoothstep, sqrt, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { COLOUR_ROWS } from './sky-children-hours.js';

/**
 * The look's numbers in one place; the playground can override any of them from the URL
 * (`P.<name>=<value>`) before the world is built. The theme ships these.
 */
export const TUNE = {
    // The air.
    horizonFall: 8.5, // how fast the horizon's band falls away with height
    midFall: 3.4, // …and the mid band
    antiLobe: 1.6, // how narrowly the pale anti-solar horizon hangs round A's bearing
    belt: [7.0, 4.0], // the Belt of Venus: elevation and spread (degrees)
    earthShadow: [1.5, 2.5], // Earth's shadow under it
    // Altocumulus: a deck of cells on a shell over the world, receding to the horizon in true
    // perspective (cells shrink and crowd toward it), lit on their near flanks, shaded at the base.
    cloudBand: [2, 40], // the elevations (degrees) the deck fades in above, and thins out toward
    cloudScale: 0.00042, // noise tiles per metre of the deck
    cloudBase: 0.62, // the density a clear sky needs before a cloud forms
    cloudSoft: 0.035, // the edge's half-width in density (never narrower than a pixel: fwidth)
    cloudEmboss: 3.2, // how strongly a cell's near flank (toward the eye and the sun) lights
    cloudThin: 6, // degrees either side of the primary bow where cloud thins (the bow keeps dark sky)
    // The layers' shells (metres): one stylised curvature, so every layer sinks to the horizon.
    shell: 120000,
    deckHeight: 2600,
    cirrusHeight: 8000,
    // One wind for every layer (m/s at the deck). It blows toward A's side, so the high streaks
    // converge on the horizon there; each layer drifts at its own share of it, so they slide past
    // each other (the deck fastest across the sky, the cirrus slower, the cloud sea slowest).
    wind: 5,
    // The passing shower: a storm wall far behind the bow's leg, its dark under-body and its rain.
    wallDist: 26000, // how far off the wall stands (metres): its rain meets the cloud sea there
    // Optics.
    bow: 0.5, // the bow's light against the key's
    thread: 0.35, // the link colour's fine thread along the bow's inner edge
    fogbowGain: 0.7,
    glory: 0.9,
    opposition: 0.6,
    // The Deep.
    shelves: [-1100, -2800, -6200], // the mist shelves' heights (metres below the eye)
    shelfScale: 0.00007,
    shelfCover: [0.56, 0.8],
    hazeReach: 9000, // metres of air before a shelf is all haze
    wedgeSoft: 0.6,
};

/** Apply overrides (numbers, or comma lists for the array entries) to TUNE. */
export function tune(overrides) {
    if (!overrides) return;
    Object.keys(overrides).forEach((key) => {
        if (!(key in TUNE)) return;
        const current = TUNE[key];
        const raw = overrides[key];
        if (Array.isArray(current)) {
            const list = String(raw).split(',').map(Number);
            if (list.length === current.length && list.every(Number.isFinite)) TUNE[key] = list;
        } else if (Number.isFinite(Number(raw))) {
            TUNE[key] = Number(raw);
        }
    });
}

/** A tileable RGBA8 noise bake as a texture (mipmapped, repeat, no colour space). */
export function createNoiseTexture(data, size, name) {
    const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.anisotropy = 8;
    map.colorSpace = THREE.NoColorSpace;
    map.needsUpdate = true;
    map.name = name;
    return map;
}

/**
 * The droplet-optics table (4 rows × width, RGBA float) as a half-float texture: linear filtering
 * of half floats is core WebGL2 (full floats need an extension phones lack).
 */
export function createLutTexture(data, width) {
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(data[i], 65000));
    const map = new THREE.DataTexture(half, width, 4, THREE.RGBAFormat, THREE.HalfFloatType);
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearFilter;
    map.generateMipmaps = false;
    map.colorSpace = THREE.NoColorSpace;
    map.needsUpdate = true;
    map.name = 'sky-children-optics-lut';
    return map;
}

/**
 * A tileable float field (RGBA) as a half-float texture: repeat, linear, no mipmaps (half-float
 * mip generation is not core on WebGL2). Its user settles what it reads with distance instead.
 */
export function createFieldTexture(data, size, name) {
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.max(-65000, Math.min(data[i], 65000)));
    const map = new THREE.DataTexture(half, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearFilter;
    map.generateMipmaps = false;
    map.colorSpace = THREE.NoColorSpace;
    map.needsUpdate = true;
    map.name = name;
    return map;
}

/** A small RGBA8 sprite (the spray puff) as a clamped, mipmapped texture. */
export function createSpriteTexture(data, size, name) {
    const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.colorSpace = THREE.NoColorSpace;
    map.needsUpdate = true;
    map.name = name;
    return map;
}

/**
 * The hour's colours as nodes: one uniform row each (COLOUR_ROWS order), rewritten by the world as
 * the hour turns. `rows` is a uniformArray of vec4.
 */
export function createLight(rows) {
    return Object.freeze(Object.fromEntries(COLOUR_ROWS.map((name, i) => [name, rows.element(i).xyz])));
}

// ── Pure helpers (laid out: no uniforms captured) ──

export const scHash21 = /* @__PURE__ */ Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)))
    .setLayout({ name: 'sc_hash21', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

export const scHash33 = /* @__PURE__ */ Fn(([p]) => fract(sin(vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6)),
)).mul(43758.5453))).setLayout({ name: 'sc_hash33', type: 'vec3', inputs: [{ name: 'p', type: 'vec3' }] });

export const scMax3 = (c) => max(c.r, max(c.g, c.b));
export const luma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Wrap an angle into (−π, π]. */
export const scWrapPi = /* @__PURE__ */ Fn(([a]) => a.sub(floor(a.add(Math.PI).div(2 * Math.PI)).mul(2 * Math.PI)))
    .setLayout({ name: 'sc_wrapPi', type: 'float', inputs: [{ name: 'a', type: 'float' }] });

/** Rounded light-wrap: N·L with a soft terminator (no hard Lambert edge, no black shadow). */
export const scWrap = /* @__PURE__ */ Fn(([ndl, w]) => clamp(ndl.add(w).div(w.add(1.0)), 0.0, 1.0))
    .setLayout({ name: 'sc_wrap', type: 'float', inputs: [{ name: 'ndl', type: 'float' }, { name: 'w', type: 'float' }] });

// ── The air ──

/**
 * The air alone along a direction (its height taken as given): the hour's three bands, the pale
 * anti-solar horizon round A's bearing, the polarised band ninety degrees from the sun.
 */
export function skyBase(dir, U) {
    const { light } = U;
    const up = max(dir.y, 0.0);
    const level = normalize(vec3(dir.x, 0.0, dir.z).add(vec3(0.0, 0.0, 1e-4)));
    const anti = normalize(vec3(U.A.x, 0.0, U.A.z).add(vec3(0.0, 0.0, 1e-4)));
    const around = dot(level, anti).sub(1.0);
    const horizon = mix(light.mid, light.horizon, exp(around.mul(TUNE.antiLobe)).mul(0.55).add(0.45));
    const h1 = exp(up.mul(-TUNE.horizonFall));
    const h2 = exp(up.mul(-TUNE.midFall));
    const base = light.zenith.add(light.mid.sub(light.zenith).mul(h2)).add(horizon.sub(light.mid).mul(h1)).toVar();
    // Skylight is polarised most at ninety degrees from the sun: the band overhead goes deepest.
    const mu = dot(dir, U.key);
    const polar = float(1.0).sub(U.polar.mul(float(1.0).sub(mu.mul(mu))).mul(smoothstep(0.0, 0.6, up)));
    base.mulAssign(polar);
    // Anti-twilight: the Belt of Venus over Earth's shadow, round the antisolar bearing.
    const elev = up.mul(57.2958);
    const lobe = exp(around.mul(1.2));
    const belt = exp(elev.sub(TUNE.belt[0]).div(TUNE.belt[1]).pow2().negate());
    const shade = exp(elev.sub(TUNE.earthShadow[0]).div(TUNE.earthShadow[1]).pow2().negate());
    base.assign(mix(base, light.belt, belt.mul(U.twilight).mul(lobe).mul(0.85)));
    base.assign(mix(base, light.earthShadow, shade.mul(U.twilight).mul(lobe).mul(0.75)));
    return base;
}

/**
 * The colour of distance along a direction: the horizon band seen level. Stone and the far isles
 * fade into this; the Deep meets it at the horizon, so nothing has a seam.
 */
export function horizonHaze(dir, U) {
    const level = normalize(vec3(dir.x, 0.0, dir.z).add(vec3(0.0, 0.0, 1e-4)));
    return skyBase(level, U);
}

/**
 * The air between the eye and something along a view direction: the sky behind it where it stands
 * against the sky (the far isles are silhouettes in it, never paler than it), the haze level with
 * the horizon below.
 */
export function airColour(dir, U) {
    return mix(horizonHaze(dir, U), skyBase(dir, U), smoothstep(0.0, 0.12, dir.y));
}

// ── The clouds' one light ──

/**
 * Every cloud in one light: the deck, the cirrus, the far banks, the storm's crown, the world's
 * cumulus and the cloud sea. The crown's hue is the hour's own row (cloudLit) and its strength the
 * key's (its brightness times its HDR gain), never the two multiplied (that would tint it twice);
 * so the crowns run a little over white at the gilded and rose hours and bloom. The shade is
 * luminous, cool and lit from below by the bright sea; at the rose and pearl hours what lies in the
 * Earth's shadow takes its colour, so only the crowns burn.
 *   lit       0..1, how squarely a face meets the sun behind us (already shaped)
 *   down      0..1, how much it looks down at the cloud sea
 *   shadowed  0..1, how deep it stands in the Earth's shadow (weighted by the hour's twilight)
 *   shade     the shade's colour (the hour's cloudShade unless given)
 *   gain      the crown's strength against the key's (0.55 for a cloud)
 */
export function cloudLight(U, lit, down, shadowed, { shade = null, gain = 0.55 } = {}) {
    const { light } = U;
    // (Never dimmer than the moon leaves a cloud: at night the crowns stay silver.)
    const crown = light.cloudLit.mul(max(U.keyGain.mul(scMax3(light.key)).mul(gain), 0.75));
    const under = mix(shade || light.cloudShade, light.mistLit.mul(0.85), clamp(down, 0.0, 1.0).mul(0.45));
    const col = mix(under, crown, lit);
    return mix(col, light.earthShadow.mul(1.1).add(light.mistLit.mul(0.1)), shadowed.mul(U.twilight).mul(0.8));
}

// ── The sky's layers ──

/**
 * Metres along a ray rising at `up` (its sine) to a layer `h` metres over the eye, on the
 * stylised shell: a flat deck would run off to infinity at the horizon; the shell bends it down
 * there, so the cells shrink and crowd toward the horizon and the haze takes them.
 */
export function shellDistance(up, h) {
    const ru = max(up, 0.0).mul(TUNE.shell);
    return float(2 * TUNE.shell * h + h * h).div(sqrt(ru.mul(ru).add(2 * TUNE.shell * h + h * h)).add(ru));
}

/** The wind's bearing (radians, + right of ahead): near A's, so the high streaks lead there. */
export const WIND_BEARING = 0.3;
const WIND = [Math.sin(WIND_BEARING), -Math.cos(WIND_BEARING)];

/**
 * How far the wind has carried a layer (metres, xz), from the mist's clock: one wind for every
 * layer, `share` its speed at that height. Far layers barely move across the sky, near ones more:
 * parallax a fixed eye can see.
 */
export function windOffset(U, share) {
    return vec2(WIND[0], WIND[1]).mul(U.mistClock.mul(TUNE.wind * share)).negate();
}

/** A ray's metres on a layer into the wind's frame: x along the wind, y across it. */
function windFrame(P) {
    return vec2(dot(P, vec2(WIND[0], WIND[1])), dot(P, vec2(-WIND[1], WIND[0])));
}

/**
 * How near a direction lies to the board's card or the HUD, 0..1 (1 inside, fading over 0.08 of
 * the frame's height outside, along an edge warped by a slow noise so no cloud traces the UI's
 * rectangle), through the frame's own camera (U.calmView): the sky there keeps its detail calm,
 * and no cloud is cut by an edge of the UI. No layout, no calm. vec2(calm, behind the UI itself).
 */
export function calmZone(dir, U, tex) {
    const p = U.calmView.mul(dir);
    const s = p.xy.div(max(p.z, 0.05)).toVar();
    const box = (r) => {
        const q = abs(s.sub(r.xy)).sub(r.zw);
        return length(max(q, 0.0)).add(min(max(q.x, q.y), 0.0));
    };
    const warp = texture(tex.noise, s.mul(1.3).add(vec2(0.17, 0.53))).r.sub(0.5).mul(0.07);
    const sdf = min(box(U.calmA), box(U.calmB)).toVar();
    const front = smoothstep(0.0, 0.1, p.z);
    // y: inside the rects themselves (unwarped), what stands behind the translucent UI.
    return vec2(float(1.0).sub(smoothstep(0.0, 0.08, sdf.add(warp))), float(1.0).sub(smoothstep(-0.004, 0.004, sdf))).mul(front);
}

/**
 * The anticrepuscular rays: the shadows of clouds behind us, parallel bands in the air that
 * converge in perspective on the antisolar point. Measured round A as the strokes are (whole
 * tiles per turn, so atan's wrap is seamless; the mip level is set by hand, since the angle's
 * derivative jumps there). 0..1, how much of the air a direction sees in shadow.
 * In the sky they live in the low, thick air, but fade over the last degrees above the horizon:
 * they point on down past it rather than converging on the glow there (which would read as a sun
 * set behind it). On the cloud sea (`surface`) they come down to the cloud tops as lanes running
 * in toward A, so the eye follows them to it. Never on the bow's own circle (it would read as
 * dashes): halved within three degrees of it.
 */
export function antiRays(dir, thetaA, U, tex, { surface = false } = {}) {
    const turn = atan(dot(dir, U.bowRight), dot(dir, U.bowDown)).div(2 * Math.PI);
    const swing = U.mistClock.mul(0.00025);
    // Texels of the broad row per radian of turn, over the radians a pixel spans round A.
    const across = U.pixelAngle.div(max(sin(thetaA), 0.02));
    const size = tex.noise.image.width;
    const lod = (tiles) => max(float(0.0), log2(across.mul((tiles * size) / (2 * Math.PI))));
    const broad = texture(tex.noise, vec2(turn.mul(5.0).add(swing), 0.13)).level(lod(5)).r;
    const fine = texture(tex.noise, vec2(turn.mul(11.0).sub(swing.mul(0.7)), 0.71)).level(lod(11)).g;
    const beam = smoothstep(0.44, 0.66, broad.mul(0.8).add(fine.mul(0.2)));
    const offBow = float(1.0).sub(exp(thetaA.sub(U.bow.x).div(0.052).pow2().negate()).mul(0.5));
    if (surface) {
        // Within some twenty-five degrees of A, never on A itself (its glow lives there).
        const lanes = smoothstep(0.03, 0.12, thetaA).mul(float(1.0).sub(smoothstep(0.38, 0.6, thetaA)));
        return beam.mul(lanes).mul(offBow).mul(U.rays);
    }
    // Not on A itself and fading toward the sides of the sky.
    const conv = smoothstep(0.035, 0.17, thetaA).mul(float(1.0).sub(smoothstep(1.2, 1.9, thetaA)));
    const up = max(dir.y, 0.0);
    const air = float(1.0).sub(exp(float(-0.06).div(up.add(0.02)))).mul(smoothstep(0.0, 0.05, up));
    return beam.mul(conv).mul(air).mul(offBow).mul(U.rays);
}

/**
 * The cirrus: fibrous streaks on a shell eight kilometres up, laid along the wind, so in
 * perspective they converge on the horizon toward the antisolar side (a leading line from the
 * empty upper sky down to the bow). Broad soft bands, combed into fibres, in a few drifts; they
 * catch the hour's light first and last (U.light.cirrus: white, gold, rose, silver) and keep off
 * the bows' band (the bow keeps dark sky behind it, Alexander's band its dark). vec4(colour, alpha).
 */
export function cirrusLayer(dir, up, bearing, thetaA, calm, U, tex) {
    const t = shellDistance(up, TUNE.cirrusHeight);
    const P = dir.xz.mul(t).add(windOffset(U, 0.6)).toVar();
    const W = windFrame(P).toVar();
    // Where the drifts are (R), and the currents that bend them (B).
    const broad = texture(tex.noise, P.mul(1 / 70000).add(vec2(0.21, 0.64))).toVar();
    // Bands along the wind, bent across it by the currents so they curve and hook.
    const q = vec2(W.x.mul(1 / 42000), W.y.mul(1 / 5200).add(broad.b.sub(0.5).mul(0.8)));
    const bands = smoothstep(0.5, 0.78, texture(tex.noise, q).r);
    // Combed into fibres along their length.
    const fibre = texture(tex.noise, vec2(W.x.mul(1 / 16000), W.y.mul(1 / 2200)).add(vec2(0.37, 0.19))).a;
    // Most drifts lie up the sky away from the storm: the empty upper sky on the storm's far side.
    const away = smoothstep(-0.05, -0.5, scWrapPi(bearing.sub(U.shower.x))).mul(0.6).add(0.4);
    const patch = smoothstep(0.45, 0.7, broad.r).mul(away);
    const R1 = U.bow.x;
    const R2 = U.bow.y;
    const inBows = smoothstep(R1.sub(0.09), R1.sub(0.055), thetaA).mul(float(1.0).sub(smoothstep(R2.add(0.055), R2.add(0.09), thetaA)));
    const inside = float(1.0).sub(smoothstep(R1.sub(0.09), R1.sub(0.055), thetaA));
    const keep = float(1.0).sub(inBows).mul(mix(1.0, 0.5, inside)).mul(smoothstep(0.12, 0.4, up))
        .mul(float(1.0).sub(calm.mul(0.4)));
    const a = bands.mul(fibre.mul(0.75).add(0.4)).mul(patch).mul(keep)
        .mul(U.cirrus)
        .mul(0.34);
    // Thin ice lit by the hour, warmed toward the belt's colour at twilight.
    const lit = U.light.cirrus.mul(U.keyGain.mul(scMax3(U.light.key)).mul(0.24).add(0.1));
    const colour = mix(lit, U.light.belt, U.twilight.mul(0.35));
    return vec4(colour, a);
}

/**
 * The altocumulus deck on its shell: cells (the sky noise's rounded heads) standing in rows across
 * the wind, gathered into a few broad drifts off the storm's far side (the frame's light mass),
 * receding to the horizon in true perspective: the cells shrink and crowd toward it and its haze
 * takes them (where a cell spans only a few pixels it dissolves into a soft veil of its own tone,
 * never confetti). We see each cell from below with the sun low behind us: its near flank lit (the
 * top of its image), falling through a mid tone into its base in the luminous shade; toward the
 * horizon we see more flank than base. Edges a pixel and a half wide (fwidth), never stickers. It
 * keeps off the Far Gate (U.gateSky), which stands on open sky. { colour, cover }.
 */
export function altoDeck(dir, up, bearing, thetaA, calm, U, tex, reads, air = null) {
    const t = shellDistance(up, TUNE.deckHeight).toVar();
    const P = dir.xz.mul(t).add(windOffset(U, 1.0)).toVar();
    const uv = P.mul(TUNE.cloudScale).toVar();
    const W = windFrame(uv).toVar();
    // The broad: how full the deck is (B), and the drifts' ragged edges (R).
    const broad = texture(tex.noise, uv.mul(0.07).add(vec2(0.71, 0.29))).toVar();
    // Composed, not scattered: the deck lies in one broad drift off the storm's far side, from low
    // over the horizon up into the upper sky (the frame's light mass); the cells drift through it,
    // forming at its windward edge and thinning at its lee.
    const off = scWrapPi(bearing.sub(U.shower.x));
    // It stays inside the primary, under the crest: white cloud behind the bow would wash it out.
    const zone = smoothstep(0.3, 0.75, off).mul(float(1.0).sub(smoothstep(1.5, 2.2, off)))
        .mul(smoothstep(0.03, 0.12, up)).mul(float(1.0).sub(smoothstep(0.45, 0.75, up)))
        .mul(smoothstep(U.bow.x.sub(0.04), U.bow.x.sub(0.16), thetaA));
    const mass = smoothstep(0.3, 0.62, zone.add(broad.r.sub(0.5).mul(1.1)));
    // The Far Gate stands on open sky: the deck thins away round its hull (a ragged clearing, its
    // edge in the drift's own noise, so it never traces the gate's outline).
    const g = U.gateSky;
    const hull = vec2(abs(scWrapPi(bearing.sub(g.x))).sub(g.y), up.sub(g.z));
    const toGate = length(max(hull, 0.0)).add(min(max(hull.x, hull.y), 0.0)).add(broad.r.sub(0.5).mul(0.05));
    const clear = float(1.0).sub(smoothstep(0.012, 0.055, toGate)).mul(g.w);
    // Rows across the wind, warped so that no two run straight (gone where a pixel spans a row).
    const warp = texture(tex.noise, uv.mul(0.11).add(0.37)).b;
    const phase = W.x.mul(1.7).add(warp.mul(2.2));
    const rowsAmp = float(1.0).sub(smoothstep(0.12, 0.35, fwidth(phase)));
    const rows = sin(phase.mul(2 * Math.PI)).mul(rowsAmp).mul(0.5).add(0.5);
    const low = texture(tex.noise, uv.mul(0.41).add(0.3)).r;
    const need = float(TUNE.cloudBase + 0.08).sub(U.cloud.mul(0.5)).sub(broad.b.sub(0.5).mul(0.4))
        .add(float(1.0).sub(mass).mul(1.0))
        .add(calm.mul(0.8))
        .add(clear)
        .toVar();
    const shared = low.mul(0.3).add(rows.mul(0.28));
    const d0 = texture(tex.noise, uv).g.mul(0.62).add(shared).toVar();
    if (reads > 3) d0.subAssign(texture(tex.noise, uv.mul(2.7).add(0.61)).a.sub(0.5).mul(0.1));
    // The same field a little nearer along the view: where it is thinner there, we see the
    // cell's near flank (the top of its image).
    const view = normalize(dir.xz.add(vec2(0.0, 1e-4)));
    const dn = texture(tex.noise, uv.sub(view.mul(0.04))).g.mul(0.62).add(shared);
    const w = max(fwidth(d0).mul(1.5), TUNE.cloudSoft);
    // How many pixels a cell spans (the heads' smaller cells are about a ninth of a tile): under
    // a few, the cells dissolve into a soft veil instead of resolving into flecks.
    const resolve = smoothstep(3.0, 7.0, float(0.09).div(max(length(fwidth(uv)), 1e-6)));
    const a = mix(smoothstep(need.sub(0.22), need.add(0.3), d0).mul(0.55), smoothstep(need.sub(w), need.add(w), d0), resolve)
        .toVar();
    const flank = clamp(d0.sub(dn).mul(TUNE.cloudEmboss).add(0.45), 0.0, 1.0);
    const heart = smoothstep(need.add(0.05), need.add(0.3), d0);
    const side = float(1.0).sub(smoothstep(0.08, 0.45, up)).mul(0.25);
    // Lit flank, a mid tone, the base: one smooth ramp (no cel steps), quiet where unresolved.
    const ramp = flank.mul(float(1.0).sub(heart.mul(0.35))).add(side).add(float(1.0).sub(a).mul(0.15));
    const lit = mix(float(0.5), smoothstep(0.0, 1.05, ramp), resolve);
    // The far deck lies in the Earth's shadow at twilight, as the belt behind it.
    const shadowed = float(1.0).sub(smoothstep(0.04, 0.3, up)).mul(0.7);
    const colour = cloudLight(U, lit, float(1.0).sub(flank).mul(0.7), shadowed).toVar();
    // Beside the card and the HUD no white burns (the UI keeps the brightest values clear).
    colour.mulAssign(float(1.0).sub(calm.mul(0.25)));
    // Far cells melt into the air behind them, wholly over the last degrees above the horizon.
    const fog = float(1.0).sub(exp(t.div(-20000.0))).mul(0.8).add(float(1.0).sub(smoothstep(0.02, 0.1, up)).mul(0.2));
    colour.assign(mix(colour, air || skyBase(dir, U), fog));
    // Fade in above the horizon and beside the bow.
    const band = smoothstep(TUNE.cloudBand[0] * 0.0175, TUNE.cloudBand[0] * 0.0175 + 0.09, up)
        .mul(float(1.0).sub(smoothstep(TUNE.cloudBand[1] * 0.0175, TUNE.cloudBand[1] * 0.0175 + 0.25, up)));
    const nearBow = exp(thetaA.sub(U.bow.x).div(TUNE.cloudThin * 0.0175).pow2().negate()).mul(0.7);
    return { colour, cover: a.mul(band).mul(float(1.0).sub(nearBow)).mul(float(1.0).sub(fog.mul(0.5))) };
}

/**
 * One row of the storm's billows: round heads standing along a crest line in bearing, each its
 * own width and height, the pixel's head the highest of its own cell's and its neighbours' (so
 * heads overlap and the row's top is a run of round lobes; a top drawn in bearing alone can
 * never shed a loose lump above it). Each head is a round bump on the row's shoulder line, so
 * beside it the row's top is the shoulder itself. `squash` flattens the heads where the wall is low.
 * vec4(the row's top elevation, how lit the pixel's head is there (its brow), 0, 0).
 */
export const scBillow = /* @__PURE__ */ Fn(([x, el, crest, slope, k, seed, squash]) => {
    const s = x.mul(k);
    const c0 = floor(s);
    // The row's shoulder under the pixel: every head stands on it, and beside a head the row's top
    // is the shoulder itself (no shelf, no cleft, no column under a head).
    const shoulder = crest.sub(squash.mul(0.06).div(k)).toVar();
    const head = (c) => {
        const h1 = scHash21(vec2(c, seed));
        const h2 = scHash21(vec2(c.add(17.0), seed));
        const r = h1.mul(0.5).add(0.7).mul(0.5).div(k);
        const rv = r.mul(squash);
        const dx = s.sub(c.add(0.5)).div(k);
        // Its peak on the crest where the head stands, not under the pixel: on a slope it stays round.
        const bump = max(crest.sub(slope.mul(dx)).add(h2.sub(0.5).mul(rv).mul(0.9)).add(rv.mul(0.55)).sub(shoulder), 0.0);
        const t = abs(dx).div(r);
        const prof = sqrt(max(float(1.0).sub(t.mul(t)), 0.0));
        return { bump, prof, top: shoulder.add(bump.mul(prof)) };
    };
    // Its own cell's head and both neighbours' (every head that can reach the pixel).
    const a = head(c0.sub(1.0));
    const b = head(c0);
    const c = head(c0.add(1.0));
    const pickB = b.top.greaterThan(a.top);
    const abBump = select(pickB, b.bump, a.bump);
    const abProf = select(pickB, b.prof, a.prof);
    const abTop = max(a.top, b.top);
    const pickC = c.top.greaterThan(abTop);
    const bump = select(pickC, c.bump, abBump);
    const prof = select(pickC, c.prof, abProf);
    // Lit on its brow (the top of the head), darker down to where it stands on the shoulder, and
    // under the shoulder the row's body, whichever head stands over it: no limb drawn round a
    // head, the brow of the head in front is the only edge on the face.
    const up = clamp(el.sub(shoulder).div(max(bump.mul(prof), 1e-5)), 0.0, 1.0);
    const brow = mix(float(0.35), float(1.0), up).mul(mix(float(0.6), float(1.0), prof));
    const under = smoothstep(0.0, squash.mul(0.4).div(k).add(1e-5), shoulder.sub(el));
    return vec4(max(c.top, abTop), mix(brow, float(0.16), under), 0.0, 0.0);
}).setLayout({
    name: 'sc_billow',
    type: 'vec4',
    inputs: [
        { name: 'x', type: 'float' }, { name: 'el', type: 'float' }, { name: 'crest', type: 'float' },
        { name: 'slope', type: 'float' }, { name: 'k', type: 'float' }, { name: 'seed', type: 'float' },
        { name: 'squash', type: 'float' },
    ],
});

/**
 * Far banks of cumulus along the horizon, forty kilometres off and more: low walls of round heads,
 * each far wider than it is tall, flat along their tops and ending in lobes (never a peak, never a
 * slope: anything pointed on a horizon reads as a mountain, and this world has no ground), their
 * feet sunk in the mist. Drawn as the storm's billows are (one style for every cloud of the dome):
 * a row of great heads with a lower row of smaller ones in front, each lit on its brow and falling
 * into a cool cleft. Hazed at least as deep as the farthest isles, so nothing on the horizon reads
 * nearer than they do. vec4(colour, alpha).
 */
export function horizonBanks(dir, bearing, U, tex, hazeIn = null) {
    const el = dir.y;
    const profile = texture(tex.noise, vec2(bearing.mul(1.3).add(0.07), 0.83));
    // Banks and gaps along the horizon, each bank flat along its top and quick at its ends.
    const tall = smoothstep(0.5, 0.58, profile.r).mul(0.017).add(smoothstep(0.56, 0.64, profile.b).mul(0.009)).toVar();
    const squash = clamp(tall.div(0.012), 0.0, 1.0).mul(0.42);
    const pa = U.pixelAngle.mul(0.75);
    const tone = float(0.0).toVar();
    const a = float(0.0).toVar();
    // crest (under the bank's top), heads per radian, seed
    [[0.0, 11.0, 2.3], [-0.45, 23.0, 6.1]].forEach(([drop, k, seed]) => {
        const b = scBillow(bearing, el, tall.mul(1.0 + drop).sub(0.008), float(0.0), float(k), float(seed), squash);
        const cover = smoothstep(pa.negate(), pa, b.x.sub(el));
        tone.assign(mix(tone, b.y, cover));
        a.assign(max(a, cover));
    });
    // Lit fronts, cool clefts and feet, then most of forty kilometres of air.
    const cloud = cloudLight(U, tone.mul(0.85), float(0.25), float(0.8));
    const haze = hazeIn || horizonHaze(dir, U);
    const air = mix(0.64, 0.9, smoothstep(0.022, -0.006, el));
    return vec4(mix(cloud, haze, air), a.mul(smoothstep(-0.02, -0.006, el)));
}

/**
 * The storm wall's skyline at `w` (its bearing in half widths): a broad body with round shoulders
 * (wider than tall, so it never reads as a mountain), a few great bulges heaving out of its top,
 * the tallest over the heart; `reach` how far its ends run, `top` the heart's height (radians),
 * `swell` a slow rise and fall along it.
 */
export const scStormHeight = /* @__PURE__ */ Fn(([w, reach, top, swell]) => {
    const x = clamp(abs(w.sub(0.05)).div(reach), 0.0, 1.0);
    const body = smoothstep(1.0, 0.5, x).sqrt().mul(0.45);
    // centre, half width, height (shares of the heart's)
    const heave = [[-0.5, 0.3, 0.26], [-0.06, 0.36, 0.55], [0.36, 0.3, 0.42], [0.7, 0.24, 0.22]].reduce((h, [c, hw, ht]) => {
        const q = w.sub(c).div(hw);
        return max(h, sqrt(max(float(1.0).sub(q.mul(q)), 0.0)).mul(ht));
    }, float(0.0));
    return body.add(heave.mul(smoothstep(0.95, 0.7, x))).mul(top).add(swell.mul(smoothstep(0.85, 0.6, x)));
}).setLayout({
    name: 'sc_stormHeight',
    type: 'float',
    inputs: [{ name: 'w', type: 'float' }, { name: 'reach', type: 'float' }, { name: 'top', type: 'float' }, { name: 'swell', type: 'float' }],
});

/**
 * The storm wall: the passing shower far behind the bow's leg, the world's cumulus tower standing
 * in front of it as the same storm's sunlit crown. Its body is the darkest large mass in the upper
 * sky (what the bow and the white falls burn against): rows of slate billows on a flat base, the
 * crown's small heads behind, the big lower ones in front, each lit on its brow by the sun behind
 * us and dark in the clefts under it (front light in the slate range, never a silver lining).
 * Under the base the rain: a dense dark curtain under the heart, broad shafts slanting with the
 * wind and ending at their own heights (some die as virga, some fall on past the horizon into the
 * mist), two of them sunlit veils off the heart. Toward the Spring Isle its flank thins to a paler
 * veil, so the isle's dark root stands off it; by the card and the bow's band its brows go quiet.
 * U.shower: x centre bearing, y half width, z base elevation, w the heart's height (radians).
 * { colour, alpha, rain } (rain: the bow's medium there).
 */
export function stormWall(dir, bearing, thetaA, calm, U, tex, hazeIn = null) {
    const { light } = U;
    const sh = U.shower;
    const el = dir.y.toVar();
    const u = scWrapPi(bearing.sub(sh.x)).div(sh.y).toVar();
    const haze = (hazeIn || horizonHaze(dir, U)).toVar();
    const base = sh.z;
    // Edges a pixel wide, from the frame's own pixel (no derivatives needed).
    const pa = U.pixelAngle.mul(0.75);
    // Along the bearing, at the wall's own scale: R the crest's swell, B how far each end reaches.
    const along = texture(tex.noise, vec2(bearing.mul(0.85).add(0.13), 0.43)).toVar();
    const reach = along.b.sub(0.5).mul(0.5).add(1.0).toVar();
    // The dark heart stands between the Mother Fall and the card, where the bow's leg climbs.
    const core = exp(u.sub(0.12).pow2().mul(-2.2)).toVar();
    // The flank toward the isle lifts to a paler veil of rain.
    const flank = smoothstep(-0.3, -0.85, u).toVar();
    const slate = mix(light.shower, mix(light.shower, haze, 0.42), flank).toVar();

    // ── The body: rows of billows on a flat base, highest over the heart ──
    // Each end steps down into the base in its own lobes (never a vertical cut, never a slope).
    const swell = along.r.sub(0.5).mul(0.035).toVar();
    // The height and its slope per radian of bearing: each head stands on the crest at its own
    // centre (the steepest part shears a little instead, so a bulge's side never steps like a stair).
    const h0 = scStormHeight(u.sub(0.02), reach, sh.w, swell).toVar();
    const h1 = scStormHeight(u.add(0.02), reach, sh.w, swell).toVar();
    const height = h0.add(h1).mul(0.5).toVar();
    const slope = clamp(h1.sub(h0).div(sh.y.mul(0.04)), -0.7, 0.7).toVar();
    // (Flatter where the wall is low, and on a small wall: a head never towers over its body.)
    const squash = clamp(height.div(max(sh.w, 0.01)).mul(1.6), 0.0, 1.0).mul(min(sh.w.mul(5.0), 1.0));
    // The billows' torn edges: the boil only ever carves in (it cannot float a lump outside).
    const fray = texture(tex.noise, vec2(bearing.mul(31.0), el.mul(31.0).sub(U.mistClock.mul(0.001)))).a;
    // Brows go quiet by the card and the HUD, and in the bow's band (the bow keeps dark cloud).
    const quiet = float(1.0).sub(calm.mul(0.7))
        .mul(float(1.0).sub(exp(thetaA.sub(U.bow.x).div(0.07).pow2().negate()).mul(0.5)));
    const tone = float(0.0).toVar();
    const bodyA = float(0.0).toVar();
    // Four rows, each painted over the one behind it: the crown's small turrets behind (at the
    // top of the height, 27 heads a radian), the great lower billows in front (8.5 a radian).
    Loop(4, ({ i }) => {
        const n = float(i);
        const share = float(1.0).sub(n.mul(0.26));
        const k = float(27.0).div(n.mul(0.72).add(1.0));
        const b = scBillow(bearing, el, base.add(height.mul(share)), slope.mul(share), k, n.mul(2.9).add(3.7), squash);
        const rRow = float(0.475).div(k);
        const d = b.x.sub(el).sub(fray.mul(rRow).mul(0.12));
        const cover = smoothstep(pa.negate(), pa, d);
        // Deeper under its own top a billow lies in the shade of the ones over it; the crown's
        // turrets stand in a little more air (they are further back).
        const occl = float(1.0).sub(smoothstep(0.0, rRow.mul(2.6), d).mul(0.4));
        const row = mix(float(0.6), float(2.3), b.y.pow(1.6).mul(quiet)).mul(occl).add(select(i.equal(0), float(0.1), float(0.0)));
        tone.assign(mix(tone, row, cover));
        bodyA.assign(max(bodyA, cover));
    });
    // A slow boil through the slate (never cells), and the base's darker underside band.
    const boil = texture(tex.noise, vec2(bearing.mul(6.5), el.mul(6.5).sub(U.mistClock.mul(0.0004)))).g;
    tone.mulAssign(boil.mul(0.3).add(0.85).mul(mix(float(0.72), float(1.0), smoothstep(base, base.add(0.035), el))));
    // The flat base: a pixel-crisp edge (and no heads past the wall's ends).
    // (A frame with no room for the body, sh.w 0, keeps only the rain falling from above it.)
    bodyA.mulAssign(smoothstep(base.sub(pa), base.add(pa), el).mul(smoothstep(reach.mul(1.12), reach, abs(u.sub(0.05))))
        .mul(smoothstep(0.004, 0.02, sh.w)));
    const bodyCol = slate.mul(tone).toVar();

    // ── The rain: broad shafts under the base, slanting with the wind ──
    const fall = base.sub(el).toVar();
    const lean = u.sub(fall.mul(1.8)).toVar();
    // centre, width, weight, how far it falls (radians), lit
    const shafts = [
        [-0.66, 0.09, 0.8, 0.05, 1], [-0.42, 0.2, 0.9, 0.12, 0], [-0.08, 0.26, 1.0, 0.2, 0],
        [0.3, 0.2, 0.9, 0.09, 0], [0.62, 0.08, 0.85, 0.2, 1], [0.84, 0.16, 0.6, 0.04, 0],
    ];
    const dense = float(0.0).toVar();
    const litShare = float(0.0).toVar();
    shafts.forEach(([c, wd, g, len, lit]) => {
        const s = exp(lean.sub(c).div(wd).pow2().negate()).mul(g).mul(float(1.0).sub(smoothstep(len * 0.5, len, fall)));
        dense.assign(max(dense, s));
        if (lit) litShare.assign(max(litShare, s));
    });
    // Under the heart a dense dark curtain, full down to the last degree over the horizon, then
    // thinning on into the mist (the bow's leg keeps its dark ground under the base).
    const heart = smoothstep(0.3, 0.75, core).toVar();
    dense.assign(max(dense, heart.mul(mix(float(0.3), float(1.05), smoothstep(-0.035, 0.014, el)))));
    // Soft change down each shaft (never a comb), calmer in the curtain.
    const vary = texture(tex.noise, vec2(lean.mul(1.9), fall.mul(4.0).sub(U.mistClock.mul(0.004)))).b;
    const streak = texture(tex.noise, vec2(lean.mul(9.0), fall.mul(1.8).sub(U.mistClock.mul(0.015)))).a;
    const grain = vary.mul(0.45).add(0.8).mul(streak.mul(0.14).add(0.93));
    // (It hangs from just above the base, so the body's edge never shows sky through a seam.)
    const rainA = min(dense.mul(mix(grain, float(1.0), heart.mul(0.6))), 0.985)
        .mul(smoothstep(-0.007, -0.002, fall)).mul(smoothstep(-0.03, -0.012, el))
        .mul(smoothstep(0.1, 0.75, U.showerAmt))
        .mul(smoothstep(reach, reach.mul(0.7), abs(lean)))
        .toVar();
    // Dark rain stays slate down to the last degree over the horizon, then pales into the mist;
    // off the heart it runs a little paler; the sunlit veils run pale.
    // (It starts at the body's own dark underside, so the base is an edge, not a step.)
    const toHaze = smoothstep(0.02, -0.03, el).mul(0.5).add(float(1.0).sub(heart).mul(0.18)).add(0.02);
    const darkRain = mix(slate.mul(mix(float(0.5), float(0.95), smoothstep(0.0, 0.035, fall))), haze, toHaze);
    const lit = smoothstep(0.35, 0.8, litShare).mul(0.85).mul(float(1.0).sub(heart.mul(0.8)));
    const veil = mix(haze, light.cloudLit.mul(scMax3(light.key).mul(U.keyGain).mul(0.3).max(0.6)), 0.3);
    const rainCol = mix(darkRain, veil, lit.mul(mix(0.7, 1.0, flank)));
    const alpha = bodyA.add(rainA.mul(float(1.0).sub(bodyA))).toVar();
    const mixed = bodyCol.mul(bodyA).add(rainCol.mul(rainA).mul(float(1.0).sub(bodyA))).div(max(alpha, 1e-4));
    // Twenty-odd kilometres of air in front of it, thicker down at the horizon and on the flanks.
    // (Little airlight before the heart: the air under a storm lies in its shadow.)
    const aired = mix(mixed, haze, smoothstep(0.04, -0.02, el).mul(0.2).add(float(1.0).sub(heart).mul(0.06)).add(0.025));
    return {
        colour: aired,
        alpha: min(alpha, 0.97),
        rain: bodyA.mul(0.55).add(rainA),
    };
}

// ── Optics ──

/** The table at a row and an angle (degrees, over that row's range): rgb light (alpha in lutA). */
function lut(tex, row, thetaDeg, range) {
    return texture(tex, vec2(clamp(thetaDeg.div(range), 0.0, 1.0), (row + 0.5) / 4)).rgb;
}

/** The whole texel (the primary row's alpha holds the supernumeraries' fringes). */
function lutA(tex, row, thetaDeg, range) {
    return texture(tex, vec2(clamp(thetaDeg.div(range), 0.0, 1.0), (row + 0.5) / 4));
}

/**
 * How much of the bow a direction shows, from the strokes the chain has painted: for each of the
 * `count` strokes in the table (vec4 phi0, phi1, progress 0..1, fade 0..1), the part already painted
 * from phi0 toward phi1, with a hairline gap at its ends so two strokes stay two. Returns
 * vec2(mask, threadWeightedIndexUnused) — the mask, and the thread colour accumulated in `thread`.
 */
function strokeMask(phi, U, first, count, thread, fill) {
    const mask = float(0.0).toVar();
    // A real loop over the strokes (read by index): one copy of the body in the shader, not twelve.
    Loop(count, ({ i }) => {
        const s = U.strokes.element(i.add(first));
        const c = U.strokes.element(i.add(12 + first));
        const span = s.y.sub(s.x);
        const safeSpan = span.add(span.sign().mul(1e-4)).add(1e-5);
        const t = scWrapPi(phi.sub(s.x)).div(safeSpan);
        const len = abs(span);
        // The painted part: from 0 to the brush's progress.
        // A finished stroke runs on a hair past its end, so it meets the next with no seam. Where a
        // neighbour in the group is painted too, the ends join tight (~0.5° of feather); where it
        // is not yet, the bow fades out over ~3° (a brushed end, never a cut). The brush's head
        // feathers over ~1.5°.
        const done = s.z.greaterThan(0.999);
        const endT = select(done, float(1.03), s.z);
        const lenSafe = max(len, 1e-3);
        const nextZ = select(i.lessThan(count - 1), U.strokes.element(min(i.add(first + 1), first + count - 1)).z, float(0.0));
        const prevZ = select(i.greaterThan(0), U.strokes.element(max(i.add(first - 1), first)).z, float(0.0));
        const endTip = select(done, select(nextZ.greaterThan(0.01), float(0.009), float(0.05)), float(0.026));
        const startTip = select(prevZ.greaterThan(0.999), float(0.009), float(0.05));
        const tip = endTip.div(lenSafe);
        const lead = startTip.div(lenSafe);
        const startIn = select(prevZ.greaterThan(0.999), smoothstep(lead.negate(), 0.0, t), smoothstep(0.0, lead, t));
        const inside = startIn.mul(float(1.0).sub(smoothstep(endT.sub(tip), endT, t)));
        // Hairline gaps at both ends (≈ 0.25° of arc), where the bow dims to a quarter.
        const gapT = float(0.0026).div(max(len, 1e-3));
        const gap = smoothstep(0.0, gapT, t).mul(smoothstep(0.0, gapT, float(1.0).sub(t))).mul(0.3).add(0.7);
        mask.assign(max(mask, inside.mul(gap).mul(s.w)));
        // The bow's inner glow fills the painted sectors without the gaps (no seams toward A); past
        // the painted run it fades over ~14° of arc, and behind a brush still painting it trails,
        // so its edge never stands as a radial line.
        const feather = float(0.25).div(lenSafe);
        const past = select(done, feather, float(0.0));
        const tail = select(done, float(0.0), float(0.35));
        const soft = smoothstep(feather.negate(), feather.mul(0.2), t)
            .mul(float(1.0).sub(smoothstep(endT.sub(tail), endT.add(past), t)));
        fill.assign(max(fill, soft.mul(s.w)));
        thread.addAssign(c.xyz.mul(c.w).mul(inside).mul(s.w));
    });
    return mask;
}

/**
 * The painted bows along a direction, the stroke work alone (it depends only on the bearing round
 * A): vec4(band1, fill1, band2, fill2) for the primary and the secondary, each already breathing,
 * and the link colours accumulated in `thread` and `thread2`. optics() runs it for each pixel of
 * the sky; the spray runs it once per corner of a puff and hands it on (`o.strokes`), since its
 * puffs are too soft for a stroke's end interpolated across one to read any differently.
 */
export function bowStrokes(dir, U, thread, thread2) {
    const phi = atan(dot(dir, U.bowRight), dot(dir, U.bowDown)).toVar();
    const fill1 = float(0.0).toVar();
    const band1 = strokeMask(phi, U, 0, 7, thread, fill1).toVar();
    const fill2 = float(0.0).toVar();
    const band2 = strokeMask(phi, U, 7, 5, thread2, fill2).toVar();
    // From a chain of ten the bows breathe: a band of light runs round both every 6 s (every 3 s at
    // the cap, where they sing).
    const breathRate = mix(float(1.047), float(2.094), smoothstep(12.5, 13.0, U.bow.w));
    const breath = exp(scWrapPi(phi.sub(U.time.mul(breathRate))).pow2().div(-0.06)).mul(smoothstep(9.5, 10.5, U.bow.w)).mul(0.7);
    return vec4(band1, fill1, band2, fill2).mul(breath.add(1.0));
}

/**
 * The droplet optics along a direction, before the drops that carry them: vec3 light.
 *   rain       how much of the bow's medium the direction crosses (0..1)
 *   deepMist   the Deep's mist (fogbow and glory live only there)
 *   strokes    { masks, thread, thread2 } from bowStrokes() run elsewhere (else it runs here)
 */
export function optics(dir, U, tex, o) {
    const { light } = U;
    const mu = clamp(dot(dir, U.A), -1.0, 1.0);
    const theta = acos(mu).toVar(); // radians from A
    const thetaDeg = theta.mul(57.2958).toVar();
    const out = vec3(0.0).toVar();
    // A long chain (dial 7 and up) burns the bow brighter, up to half again at the cap.
    const key = light.key.mul(U.bowGain).mul(smoothstep(6.5, 13.0, U.bow.w).mul(0.5).add(1.0));

    const R1 = U.bow.x;
    const R2 = U.bow.y;
    let masks;
    let thread;
    let thread2;
    if (o.strokes) {
        ({ masks, thread, thread2 } = o.strokes);
    } else {
        thread = vec3(0.0).toVar();
        thread2 = vec3(0.0).toVar();
        masks = bowStrokes(dir, U, thread, thread2).toVar();
    }
    const t1 = theta.div(R1).mul(42.0).toVar(); // degrees on the table's primary scale
    const t2 = theta.div(R2).mul(51.0).toVar();
    // The gaps live only in the bow's band; inside it the glow follows the painted sectors whole.
    const m1 = mix(masks.y, masks.x, exp(t1.sub(41.6).div(0.7).pow2().negate())).toVar();
    const m2 = mix(masks.w, masks.z, exp(t2.sub(51.6).div(0.9).pow2().negate())).toVar();
    const primTexel = lutA(tex.lut, 0, t1, 60.0);
    const prim = primTexel.rgb.toVar();
    const sec = lut(tex.lut, 1, t2, 60.0).toVar();
    // The sky inside the bow brightens a little more than the drops alone give.
    prim.mulAssign(float(1.0).add(float(1.0).sub(smoothstep(39.0, 41.5, t1)).mul(0.1)));
    // Supernumeraries ring pale green and violet inside the primary once the chain holds (dial ≥ 3).
    const dial = U.bow.w;
    const superGain = smoothstep(2.4, 3.2, dial);
    const pastel = mix(vec3(0.55, 0.85, 0.62), vec3(0.72, 0.6, 0.9), smoothstep(37.5, 39.5, t1));
    prim.addAssign(pastel.mul(primTexel.a).mul(superGain).mul(0.14));
    // The colours: the moonbow is all but white.
    const pv = mix(vec3(luma(prim)), prim, U.bowSat);
    const sv = mix(vec3(luma(sec)), sec, U.bowSat);
    const veil = o.rain;
    // In spray the bow is faintly there even before the chain paints it: the promise of the bow.
    const restGain = o.rest !== undefined ? o.rest : float(0.0);
    out.addAssign(pv.mul(key).mul(max(m1, restGain)).mul(veil).mul(TUNE.bow));
    out.addAssign(sv.mul(key).mul(max(m2, restGain.mul(0.5))).mul(veil).mul(TUNE.bow));
    // The link colours: a fine thread along the inner edge of each painted stroke.
    const threadBand = exp(t1.sub(39.6).div(0.35).pow2().negate());
    out.addAssign(thread.mul(threadBand).mul(TUNE.thread).mul(veil));
    const threadBand2 = exp(t2.sub(52.0).div(0.4).pow2().negate());
    out.addAssign(thread2.mul(threadBand2).mul(TUNE.thread * 0.6).mul(veil));
    // Alexander's band: the sky between the bows darkens once the chain is long (dial ≥ 5).
    const between = smoothstep(R1.add(0.01), R1.add(0.03), theta).mul(float(1.0).sub(smoothstep(R2.sub(0.03), R2.sub(0.01), theta)));
    const alexander = between.mul(smoothstep(2.5, 3.5, dial).mul(0.22).add(smoothstep(6.5, 9.0, dial).mul(0.13))).mul(veil);
    if (o.deep) {
        // The fogbow: broad and white on the mist, always faintly there.
        const tf = theta.div(U.bow.z).mul(39.0);
        const fog = lut(tex.lut, 2, tf, 60.0);
        out.addAssign(mix(vec3(luma(fog)), fog, U.bowSat.mul(0.6)).mul(key).mul(U.fogbow.mul(TUNE.fogbowGain)).mul(o.deepMist));
        // The opposition glow and the glory, round A on the mist.
        // Row 3 holds the glory's rings over the opposition glow; the rings alone are gated.
        const oppShape = exp(thetaDeg.div(-2.5));
        const g = max(lut(tex.lut, 3, thetaDeg, 25.0).sub(oppShape.mul(0.6)), vec3(0.0)).toVar();
        // The opposition glow is broad and soft, the mist's own light brightened (not a glint).
        const opp = exp(thetaDeg.div(-6.0)).mul(TUNE.opposition).mul(U.glory.z.mul(2.0).add(U.glory.w));
        const ringsOpen = smoothstep(U.glory.y.add(0.4), U.glory.y.sub(0.2), thetaDeg).mul(U.glory.x);
        out.addAssign(mix(light.mistLit, light.key, 0.35).mul(opp).mul(o.deepMist).mul(U.keyGain.mul(0.22)));
        // The rings a little softer in colour than the table (they sit in the mist, not on it).
        out.addAssign(mix(vec3(luma(g)), g, 0.72).mul(light.key).mul(ringsOpen).mul(TUNE.glory)
            .mul(o.deepMist));
    }
    return vec4(out, alexander);
}

// ── The Deep ──

/**
 * How much of a point on a mist layer lies in the isles' shadows: the ray from the point toward the
 * sun passes within a caster's radius of its axis (U.casters: a, radius / b, strength). A real loop,
 * so a shader carries one copy of it however many casters there are.
 */
export function casterShadow(P, U, count) {
    const shadow = float(0.0).toVar();
    Loop(Math.min(8, count), ({ i: k }) => {
        const ca = U.casters.element(k.mul(2));
        const cb = U.casters.element(k.mul(2).add(1));
        // Work in the plane across the sun's ray.
        const toA = ca.xyz.sub(P);
        const toB = cb.xyz.sub(P);
        const pa = toA.sub(U.key.mul(dot(toA, U.key)));
        const pb = toB.sub(U.key.mul(dot(toB, U.key)));
        const ab = pb.sub(pa);
        const h2 = clamp(dot(pa.negate(), ab).div(max(dot(ab, ab), 1e-3)), 0.0, 1.0);
        const dist = length(pa.add(ab.mul(h2)));
        const ahead = smoothstep(0.0, 50.0, dot(toA, U.key));
        const r = ca.w;
        // Penumbra grows with the distance back to the caster.
        const pen = r.mul(TUNE.wedgeSoft).add(dot(toA, U.key).mul(0.0045));
        shadow.assign(max(shadow, float(1.0).sub(smoothstep(r.sub(pen), r.add(pen), dist)).mul(ahead).mul(cb.w)));
    });
    return shadow;
}

/**
 * The toll: rings of the hour's light running out across the cloud sea from under the Spring Isle
 * (its caster's top), three of them a quarter-second apart. `P` is a point on the sea.
 */
export function tollRings(P, U) {
    const c0 = U.casters.element(0).xyz;
    const across = length(P.xz.sub(c0.xz));
    const tollAge = U.time.sub(U.toll.x);
    const rings = float(0.0).toVar();
    [0, 0.3, 0.6].forEach((lag) => {
        const age = tollAge.sub(lag);
        const R = max(age, 0.0).mul(2600.0);
        rings.addAssign(exp(across.sub(R).div(R.mul(0.06).add(140.0)).pow2().negate())
            .mul(exp(age.mul(-0.42))).mul(smoothstep(0.0, 0.08, age)));
    });
    return rings.mul(U.toll.y);
}

/** The toll's light (the hour's key toward its accent). */
export function tollLight(U) {
    return mix(U.light.key, U.light.accent, 0.35).mul(0.9);
}

/**
 * The Deep along a direction below the horizon: the luminous abyss falling to the deep's
 * blue-violet, the mist shelves from `from` down composited front to back (the nearest one in the
 * isles' shadows), and the wall of mist just under the horizon. Returns { colour, mist } (mist:
 * how much of the view is droplets, for the optics).
 */
export function deepColour(dir, U, tex, {
    from = 0, shelves = 3, casters = 0, haze: hazeIn = null,
} = {}) {
    const { light } = U;
    const below = max(dir.y.negate(), 0.0).toVar();
    const sink = smoothstep(0.0, 0.45, sqrt(below));
    const haze = (hazeIn || horizonHaze(dir, U)).toVar();
    const abyss = mix(mix(light.mistLit, haze, 0.45), light.deep, sink.mul(sink.mul(-0.35).add(1.35))).toVar();
    const shelfCol = vec3(0.0).toVar();
    const transmit = float(1.0).toVar();
    const keyFlat = normalize(vec2(U.key.x, U.key.z).add(vec2(0.0, 1e-4)));
    const toll = float(0.0).toVar();
    for (let i = from; i < Math.min(3, shelves); i++) {
        const h = TUNE.shelves[i];
        const t = float(-h).div(max(below, 1e-3)).toVar(); // metres to the shelf along the ray
        const P = dir.mul(t).toVar();
        const at = P.xz.mul(TUNE.shelfScale * [1.6, 1.0, 0.75][i]).add(vec2(U.mistClock.mul(0.0007 * (1 + i)), i * 0.37));
        const n1 = texture(tex.noise, at).g.toVar();
        const n2 = texture(tex.noise, at.mul(0.37).add(0.5)).r;
        const field = n1.mul(0.6).add(n2.mul(0.55)).toVar();
        const a = smoothstep(TUNE.shelfCover[0], TUNE.shelfCover[1], field).toVar();
        const lee = texture(tex.noise, at.add(keyFlat.mul(0.01))).g.mul(0.6).add(n2.mul(0.55));
        const lit = clamp(field.sub(lee).mul(8.0).add(0.5), 0.0, 1.0);
        // Only the nearest shelf drawn takes the isles' shadows.
        const shadow = i === from && casters > 0 ? casterShadow(P, U, casters) : float(0.0);
        const fogged = float(1.0).sub(exp(t.div(-TUNE.hazeReach))).toVar();
        // Lower shelves lie in less light: each one down is dimmer and bluer.
        const depthTint = mix(vec3(1.0), light.mistShade.div(max(scMax3(light.mistShade), 1e-3)), float(i * 0.22));
        const top = mix(light.mistShade, light.mistLit, lit).mul(depthTint).mul(1.0 - i * 0.3)
            .mul(float(1.0).sub(shadow.mul(U.shadowDepth)));
        if (i === 0) toll.assign(tollRings(P, U));
        const colour = mix(top, mix(abyss, haze, 0.35), fogged.mul(0.8));
        const veilA = a.mul(0.7 - i * 0.16);
        shelfCol.addAssign(colour.mul(veilA).mul(transmit));
        transmit.mulAssign(float(1.0).sub(veilA));
    }
    const deep = shelfCol.add(abyss.mul(transmit)).toVar();
    // The toll's rings lie on the mist and the haze between alike.
    if (from === 0) deep.addAssign(tollLight(U).mul(toll).mul(smoothstep(0.0, 0.04, below)));
    // A luminous wall of mist just under the horizon: it swallows the isles' roots.
    deep.assign(mix(deep, mix(light.mistLit, haze, 0.5), exp(below.mul(-10.0)).mul(0.55)));
    return { colour: deep, mist: float(1.0).sub(transmit.mul(0.55)) };
}

// ── The sky ──

/**
 * The sky along a unit direction, scene-linear, in the hour's light.
 *
 * @param {object} dir   vec3 node (unit)
 * @param {object} U     the world's uniforms
 * @param {object} tex   { noise, lut }
 * @param {object} o
 * @param {number} o.slices   the altocumulus deck's reads (0: none; above 3 a fine octave)
 * @param {boolean} o.shower  the storm wall and its rain
 * @param {boolean} o.rays    the anticrepuscular rays
 * @param {boolean} o.cirrus  the cirrus
 * @param {boolean} o.banks   the far banks along the horizon
 * @param {boolean} o.calm    keep the sky's detail calm round the card and the HUD (U.calmView)
 * @param {boolean} o.seaMesh the cloud sea is a mesh of its own (the dome keeps the shelves under it)
 * @param {number} o.stars    star layers (0..2)
 * @param {boolean} o.milky   the Milky Way
 * @param {number} o.shelves  mist shelves in the Deep (0..3)
 * @param {number} o.casters  isle casters the shelves are shadowed by (0..8)
 * @param {boolean} o.optics  the bow, fogbow, glory
 */
export function skyColour(dir, U, tex, o) {
    const { light } = U;
    const up = max(dir.y, 0.0).toVar();
    const below = max(dir.y.negate(), 0.0).toVar();
    const base = skyBase(dir, U).toVar();
    const sky = base.toVar();
    const bearing = atan(dir.x, dir.z.negate()).toVar(); // 0 straight ahead, + to the right

    // ── Stars and the Milky Way: behind everything (night) ──
    if (o.stars > 0) {
        const c = cos(U.starTurn);
        const s = sin(U.starTurn);
        const axis = vec3(0.7986, 0.6018, 0.0);
        const q = dir.mul(c).add(axis.cross(dir).mul(s)).add(axis.mul(dot(axis, dir)).mul(float(1.0).sub(c))).toVar();
        const dark = U.stars.mul(smoothstep(0.05, 0.35, up));
        // `rarity`: the share of cells left empty (most of the sky holds no bright star).
        const starLayer = (scale, power, gain, rarity) => {
            const p = q.mul(scale);
            const cell = floor(p);
            const h = scHash33(cell).toVar();
            const star = normalize(cell.add(h.mul(0.56).add(0.22)));
            const off = q.sub(star).mul(scale);
            const bright = h.y.pow(power).mul(smoothstep(rarity, rarity + 0.03, h.x));
            const twinkle = sin(U.time.mul(h.x.mul(1.7).add(0.6)).add(h.z.mul(40.0))).mul(0.3).add(0.7);
            const tint = mix(vec3(1.0, 0.82, 0.64), vec3(0.72, 0.84, 1.0), fract(h.z.mul(7.31)));
            return tint.mul(exp(dot(off, off).mul(-650.0)).mul(bright).mul(twinkle).mul(gain));
        };
        const stars = starLayer(44.0, 5.0, 9.0, 0.88).toVar();
        if (o.stars > 1) stars.addAssign(starLayer(105.0, 4.0, 1.4, 0.62));
        if (o.milky) {
            const pole = vec3(0.42, -0.71, -0.57);
            const off = dot(q, pole).toVar();
            const along = atan(dot(q, vec3(0.526, 0.773, -0.353)), dot(q, vec3(-0.64, 0.087, -0.763))).toVar();
            const core = exp(along.sub(0.35).pow2().mul(-2.2));
            // Whole numbers of tiles round the band (3 and 5 per turn), so atan's wrap at ±π is seamless.
            const clot = texture(tex.noise, vec2(along.mul(3.0 / (2 * Math.PI)), off.mul(1.6).add(0.31))).toVar();
            const lane = smoothstep(0.36, 0.86, texture(tex.noise, vec2(along.mul(5.0 / (2 * Math.PI)).add(0.2), off.mul(2.4))).b);
            const width = core.mul(9.0).sub(17.0);
            // Star clouds: the band is grain, not smoke, as fine along the band as across it
            // (whole tiles round it; the level set by hand from the faster of the two rates, since
            // the angle's derivative jumps at its wrap).
            const size = tex.noise.image.width;
            const lod = (turnRate, acrossRate) => max(float(0.0), log2(U.pixelAngle.mul(Math.max(turnRate / (2 * Math.PI), acrossRate) * size)));
            const grain = texture(tex.noise, vec2(along.mul(150.0 / (2 * Math.PI)), off.mul(24.0).add(0.6))).level(lod(150, 24)).a;
            // Dust: fine dark filaments threading the band, besides the great rift.
            const dust = smoothstep(0.46, 0.72, texture(tex.noise, vec2(along.mul(35.0 / (2 * Math.PI)).add(0.4), off.mul(5.5)))
                .level(lod(35, 5.5)).b);
            const inner = exp(off.mul(off).mul(-60.0));
            const band = exp(off.mul(off).mul(width)).mul(clot.r.mul(1.1).add(0.25)).mul(core.mul(1.7).add(0.5))
                .mul(mix(float(1.0), mix(float(0.65), float(1.3), grain), inner))
                .mul(float(1.0).sub(lane.mul(exp(off.mul(off).mul(-70.0))).mul(0.85)))
                .mul(float(1.0).sub(dust.mul(inner).mul(0.55)));
            // A warm core, cool arms.
            const glow = mix(vec3(0.28, 0.34, 0.62), vec3(0.66, 0.58, 0.52), exp(off.mul(off).mul(-90.0)).mul(clot.b).mul(core.mul(0.6).add(0.4)));
            sky.addAssign(glow.mul(band).mul(0.3).mul(dark).mul(U.milky));
            stars.mulAssign(band.mul(2.4).add(1.0));
        }
        sky.addAssign(stars.mul(dark));
    }

    // The rain the bow burns in (the storm's, below).
    const rain = float(0.0).toVar();
    // How near the card and the HUD a direction lies: the sky keeps its detail calm there.
    const calmUI = o.calm ? calmZone(dir, U, tex).toVar() : vec2(0.0);
    const calm = calmUI.x;
    const thetaA = acos(clamp(dot(dir, U.A), -1.0, 1.0)).toVar();

    // ── The anticrepuscular rays: shadow bands in the air, converging on A ──
    if (o.rays) {
        const shade = light.earthShadow.div(max(scMax3(light.earthShadow), 1e-3));
        const rays = antiRays(dir, thetaA, U, tex);
        sky.assign(mix(sky, sky.mul(mix(vec3(1.0), shade, 0.5)).mul(0.5), rays.mul(float(1.0).sub(calm.mul(0.5)))));
    }

    // ── The cirrus, eight kilometres up ──
    if (o.cirrus) {
        // Thin ice scatters light into the view: it lifts the sky behind it, never greys it.
        const ci = cirrusLayer(dir, up, bearing, thetaA, calm, U, tex);
        sky.assign(sky.mul(float(1.0).sub(ci.w.mul(0.3))).add(ci.xyz.mul(ci.w)));
    }

    // ── The altocumulus deck ──
    if (o.slices > 0) {
        const deck = altoDeck(dir, up, bearing, thetaA, calm, U, tex, o.slices, base);
        sky.assign(mix(sky, deck.colour, deck.cover));
    }

    // ── The Deep: no ground, a luminous haze darkening downward, ragged shelves far below ──
    // (With the cloud sea drawn as a mesh, the dome keeps only the shelves under it.)
    // The horizon's haze along this bearing, shared by every layer that fades into it.
    const levelHaze = horizonHaze(dir, U).toVar();
    const deep = deepColour(dir, U, tex, {
        from: o.seaMesh ? 1 : 0, shelves: o.shelves, casters: o.seaMesh ? 0 : o.casters, haze: levelHaze,
    });
    const deepMist = deep.mist;
    {
        // Meet the horizon without a seam.
        const seam = smoothstep(0.0, 0.035, below);
        sky.assign(mix(sky, mix(levelHaze, deep.colour, seam), smoothstep(0.0, 0.002, below)));
    }

    // ── Far banks along the horizon, their feet in the mist ──
    if (o.banks) {
        const banks = horizonBanks(dir, bearing, U, tex, levelHaze);
        sky.assign(mix(sky, banks.xyz, banks.w));
    }

    // ── The storm wall far behind the bow's leg; its rain falls on past the horizon ──
    if (o.shower) {
        // (Not behind the card or the HUD: through the glass it would only be a dark ghost.)
        const wall = stormWall(dir, bearing, thetaA, calm, U, tex, levelHaze);
        sky.assign(mix(sky, wall.colour, wall.alpha.mul(float(1.0).sub(calmUI.y.mul(0.85)))));
        rain.assign(max(rain, wall.rain));
    }

    // ── The droplet optics: the bow in the rain and the Deep's mist, the fogbow, the glory ──
    if (o.optics) {
        const drops = max(rain, deepMist.mul(smoothstep(0.0, 0.03, below))).toVar();
        // The chain's spray veils: as the dial rises, mist lifts into the bow's band everywhere.
        const veil = texture(tex.noise, dir.xz.div(abs(dir.y).add(0.25)).mul(0.6).add(U.drift.mul(0.4))).r;
        const dialVeil = smoothstep(0.0, 1.2, U.bow.w).mul(veil.mul(0.5).add(0.55));
        const opt = optics(dir, U, tex, { rain: max(drops, dialVeil), deep: true, deepMist: deepMist.mul(smoothstep(0.0, 0.03, below)) }).toVar();
        sky.mulAssign(float(1.0).sub(opt.w));
        sky.addAssign(opt.xyz);
    }
    return sky;
}

export { abs };

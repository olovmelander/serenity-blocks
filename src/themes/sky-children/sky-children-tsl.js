/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children — Irisfall: shared TSL. The whole distance as ONE function of a direction.
 *
 * The sun is BEHIND the eye. Ahead is the other half of the sky: deep cobalt overhead, darkest in
 * the band ninety degrees from the sun, paling to an aqua-pearl haze on the far horizon; altocumulus
 * with their lit faces turned toward us; a slate passing shower far off trailing virga, the dark the
 * bow burns against. Under the horizon there is no ground: the Deep, a bottomless luminous haze with
 * ragged mist shelves kilometres down, the isles' shadows lying across them as wedges converging on
 * the antisolar point A, where the opposition glow brightens the mist and, when the board earns it,
 * the glory opens.
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
    cloudBand: [3, 40], // the elevations (degrees) the deck fades in above, and thins out toward
    cloudScale: 0.00042, // noise tiles per metre of the deck
    cloudBase: 0.62, // the density a clear sky needs before a cloud forms
    cloudSoft: 0.035, // the edge's half-width in density (never narrower than a pixel: fwidth)
    cloudEmboss: 5.5, // how strongly a cell's near flank (toward the eye and the sun) lights
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
 * How near a direction lies to the board's card or the HUD, 0..1 (1 inside, fading over 0.035 of
 * the frame's height outside), through the frame's own camera (U.calmView): the sky there keeps
 * its detail calm, and no cloud is cut by an edge of the UI. No layout, no calm.
 */
export function calmZone(dir, U) {
    const p = U.calmView.mul(dir);
    const s = p.xy.div(max(p.z, 0.05));
    const box = (r) => {
        const q = abs(s.sub(r.xy)).sub(r.zw);
        return length(max(q, 0.0)).add(min(max(q.x, q.y), 0.0));
    };
    const sdf = min(box(U.calmA), box(U.calmB));
    return float(1.0).sub(smoothstep(0.0, 0.035, sdf)).mul(smoothstep(0.0, 0.1, p.z));
}

/**
 * The anticrepuscular rays: the shadows of clouds behind us, parallel bands in the air that
 * converge in perspective on the antisolar point. Measured round A as the strokes are (whole
 * tiles per turn, so atan's wrap is seamless; the mip level is set by hand, since the angle's
 * derivative jumps there). 0..1, how much of the air a direction sees in shadow.
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
    // Not on A itself (the glow lives there) and fading toward the sides of the sky.
    const conv = smoothstep(0.035, 0.17, thetaA).mul(float(1.0).sub(smoothstep(1.2, 1.9, thetaA)));
    // More air toward the horizon, where the beams read best (on a surface they are shadows).
    if (surface) return beam.mul(conv).mul(U.rays);
    const air = float(1.0).sub(exp(float(-0.35).div(abs(dir.y).add(0.06))));
    return beam.mul(conv).mul(air).mul(U.rays);
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
    const lit = U.light.cirrus.mul(U.keyGain.mul(scMax3(U.light.key)).mul(0.34).add(0.14));
    const colour = mix(lit, U.light.belt, U.twilight.mul(0.35));
    return vec4(colour, a);
}

/**
 * The altocumulus deck on its shell: cells (the sky noise's rounded heads) standing in rows across
 * the wind, gathered into a few broad drifts off the storm's far side (the frame's light mass),
 * receding to the horizon in true perspective: the cells shrink and crowd toward it and its haze
 * takes them. We see each cell from below with the sun low behind us: its near flank lit (the top of
 * its image), its base below in the luminous shade; toward the horizon we see more flank than base.
 * Crisp edges a pixel or so wide (fwidth), never stickers. { colour, cover }.
 */
export function altoDeck(dir, up, bearing, thetaA, calm, U, tex, reads) {
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
    // Rows across the wind, warped so that no two run straight (gone where a pixel spans a row).
    const warp = texture(tex.noise, uv.mul(0.11).add(0.37)).b;
    const phase = W.x.mul(1.7).add(warp.mul(2.2));
    const rowsAmp = float(1.0).sub(smoothstep(0.12, 0.35, fwidth(phase)));
    const rows = sin(phase.mul(2 * Math.PI)).mul(rowsAmp).mul(0.5).add(0.5);
    const low = texture(tex.noise, uv.mul(0.41).add(0.3)).r;
    const need = float(TUNE.cloudBase + 0.08).sub(U.cloud.mul(0.5)).sub(broad.b.sub(0.5).mul(0.4))
        .add(float(1.0).sub(mass).mul(1.0))
        .add(calm.mul(0.8))
        .toVar();
    const shared = low.mul(0.3).add(rows.mul(0.28));
    const d0 = texture(tex.noise, uv).g.mul(0.62).add(shared).toVar();
    if (reads > 3) d0.subAssign(texture(tex.noise, uv.mul(2.7).add(0.61)).a.sub(0.5).mul(0.1));
    // The same field a little nearer along the view: where it is thinner there, we see the
    // cell's near flank (the top of its image).
    const view = normalize(dir.xz.add(vec2(0.0, 1e-4)));
    const dn = texture(tex.noise, uv.sub(view.mul(0.04))).g.mul(0.62).add(shared);
    const w = max(fwidth(d0).mul(0.9), TUNE.cloudSoft);
    const a = smoothstep(need.sub(w), need.add(w), d0).toVar();
    const flank = clamp(d0.sub(dn).mul(TUNE.cloudEmboss).add(0.4), 0.0, 1.0);
    const heart = smoothstep(need.add(0.05), need.add(0.28), d0);
    const side = float(1.0).sub(smoothstep(0.08, 0.45, up)).mul(0.3);
    const lit = smoothstep(0.12, 0.9, flank.mul(float(1.0).sub(heart.mul(0.5))).add(side).add(float(1.0).sub(a).mul(0.2)));
    // The far deck lies in the Earth's shadow at twilight, as the belt behind it.
    const shadowed = float(1.0).sub(smoothstep(0.04, 0.3, up)).mul(0.7);
    const colour = cloudLight(U, lit, float(1.0).sub(flank).mul(0.7), shadowed).toVar();
    // Far cells melt into the air behind them.
    const fog = float(1.0).sub(exp(t.div(-24000.0)));
    colour.assign(mix(colour, skyBase(dir, U), fog.mul(0.8)));
    // Fade in above the horizon and beside the bow.
    const band = smoothstep(TUNE.cloudBand[0] * 0.0175, TUNE.cloudBand[0] * 0.0175 + 0.06, up)
        .mul(float(1.0).sub(smoothstep(TUNE.cloudBand[1] * 0.0175, TUNE.cloudBand[1] * 0.0175 + 0.25, up)));
    const nearBow = exp(thetaA.sub(U.bow.x).div(TUNE.cloudThin * 0.0175).pow2().negate()).mul(0.7);
    return { colour, cover: a.mul(band).mul(float(1.0).sub(nearBow)).mul(float(1.0).sub(fog.mul(0.4))) };
}

/**
 * Far banks of cumulus along the horizon, forty kilometres off and more: lobed tops of varying
 * height on a flat foot sunk in the mist, so the horizon is never a ruler line, and the bright
 * haze band breaks into values. Hazed nearly into the air (anything nearer stands out more).
 * vec4(colour, alpha).
 */
export function horizonBanks(dir, bearing, U, tex) {
    const el = dir.y;
    const profile = texture(tex.noise, vec2(bearing.mul(1.3).add(0.07), 0.83));
    // Banks and gaps along the horizon; none in the storm's window (the wall stands there).
    const storm = exp(scWrapPi(bearing.sub(U.shower.x)).div(U.shower.y).pow2().mul(-1.5)).mul(U.showerAmt);
    const tall = smoothstep(0.42, 0.72, profile.r).mul(0.04).add(smoothstep(0.5, 0.78, profile.b).mul(0.02))
        .mul(float(1.0).sub(storm));
    const heads = texture(tex.noise, vec2(bearing, el).mul(9.0).add(vec2(0.17, 0.58))).g;
    const top = tall.mul(heads.mul(0.75).add(0.45)).sub(0.003);
    const depth = top.sub(el);
    const aa = max(fwidth(depth), 0.0006);
    const a = smoothstep(aa.negate(), aa, depth).mul(smoothstep(-0.022, -0.006, el)).toVar();
    // Lit along their tops (the heads' crowns), cool and bluer down into the foot.
    const crown = float(1.0).sub(smoothstep(0.0, 0.01, depth)).mul(smoothstep(0.3, 0.7, heads));
    const cloud = cloudLight(U, crown.mul(0.85).add(0.1), float(0.2), float(0.8));
    const haze = horizonHaze(dir, U);
    return vec4(mix(cloud, haze, mix(0.58, 0.82, smoothstep(0.014, -0.012, el))), a);
}

/**
 * The storm wall: the passing shower far behind the bow's leg, the world's cumulus tower standing
 * in front of it as the same storm's sunlit crown. Its body is the darkest large mass in the upper
 * sky (what the bow and the white falls burn against): dark slate billows on a flat base, their
 * ragged top catching the low sun behind us in a lit rim. Under the base the rain hangs in broad
 * shafts that slant with the wind and end at their own heights (some die as virga, some fall on
 * past the horizon into the mist); two of them are sunlit veils, pale against the dark. Toward the
 * Spring Isle its flank thins to a paler veil, so the isle's dark root stands off it.
 * U.shower: x centre bearing, y half width, z base elevation, w the core's height (radians).
 * { colour, alpha, rain } (rain: the bow's medium there).
 */
export function stormWall(dir, bearing, U, tex) {
    const { light } = U;
    const sh = U.shower;
    const el = dir.y.toVar();
    const u = scWrapPi(bearing.sub(sh.x)).div(sh.y).toVar();
    const haze = horizonHaze(dir, U).toVar();
    const base = sh.z;
    // Along the bearing, at the wall's own scale: R the top's line, B how far each end reaches.
    const along = texture(tex.noise, vec2(bearing.mul(0.85).add(0.13), 0.43)).toVar();
    const reach = along.b.sub(0.5).mul(0.5).add(1.0);
    const across = float(1.0).sub(smoothstep(reach.mul(0.6), reach, abs(u))).mul(smoothstep(0.1, 0.6, U.showerAmt)).toVar();
    // The dark heart stands between the Mother Fall and the card, where the bow's leg climbs.
    const core = exp(u.sub(0.12).pow2().mul(-2.2)).toVar();
    // The flank toward the isle lifts to a paler veil of rain.
    const flank = smoothstep(-0.3, -0.85, u).toVar();
    const slate = mix(light.shower, mix(light.shower, haze, 0.42), flank).toVar();

    // ── The body: billows on a flat base, the top highest over the heart ──
    const top = base.add(mix(float(0.012), sh.w, core)).add(along.r.sub(0.5).mul(0.04));
    // The cauliflower edge: rounded heads at two sizes (round in angle), slowly boiling.
    const at = vec2(bearing.mul(2.3), el.mul(2.3).sub(U.mistClock.mul(0.0003)));
    const heads = texture(tex.noise, at).g.mul(0.6).add(texture(tex.noise, at.mul(2.3).add(vec2(0.37, 0.11))).g.mul(0.4)).toVar();
    const depth = top.add(heads.sub(0.5).mul(0.09)).sub(el).toVar();
    const aa = max(fwidth(depth), 0.0012);
    const bodyA = smoothstep(aa.negate(), aa, depth).mul(smoothstep(base.sub(0.0015), base.add(0.0025), el)).mul(across).toVar();
    // Inside, the billows show only as slow changes of slate, darkest toward the base.
    const tone = mix(float(0.8), float(1.25), heads).mul(mix(float(0.72), float(1.0), smoothstep(base, base.add(0.07), el)));
    // The top's rim catches the sun behind us, on the heads that stand proud.
    const rim = float(1.0).sub(smoothstep(0.0, 0.014, depth)).mul(smoothstep(0.25, 0.75, heads).mul(0.6).add(0.4)).toVar();
    const bodyCol = mix(slate.mul(tone), cloudLight(U, float(0.7), float(0.0), float(0.7)), rim.mul(0.7));

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
    // A thin veil under the whole heart, and soft change down each shaft (never a comb).
    dense.assign(max(dense, mix(core, float(1.0), 0.35).mul(0.85).mul(float(1.0).sub(smoothstep(0.02, 0.1, fall)))));
    const vary = texture(tex.noise, vec2(lean.mul(1.9), fall.mul(4.0).sub(U.mistClock.mul(0.004)))).b;
    const streak = texture(tex.noise, vec2(lean.mul(9.0), fall.mul(1.8).sub(U.mistClock.mul(0.015)))).a;
    const rainA = min(dense.mul(vary.mul(0.45).add(0.8)).mul(streak.mul(0.14).add(0.93)), 0.97)
        .mul(smoothstep(-0.0015, 0.003, fall)).mul(smoothstep(-0.03, -0.012, el))
        .mul(across)
        .toVar();
    // Dark rain pales a little as it falls (more air before it); the sunlit veils run pale.
    const darkRain = mix(slate.mul(0.9), haze, smoothstep(0.0, 0.08, fall).mul(0.18).add(0.05));
    const lit = smoothstep(0.35, 0.8, litShare).mul(0.85);
    const veil = mix(haze, cloudLight(U, float(0.6), float(0.4), float(0.5)), 0.4);
    const rainCol = mix(darkRain, veil, lit.mul(mix(0.7, 1.0, flank)));
    const alpha = bodyA.add(rainA.mul(float(1.0).sub(bodyA))).toVar();
    const mixed = bodyCol.mul(bodyA).add(rainCol.mul(rainA).mul(float(1.0).sub(bodyA))).div(max(alpha, 1e-4));
    // Twenty-odd kilometres of air in front of it, thicker down at the horizon.
    // (Little airlight: the air under a storm lies in its shadow.)
    const aired = mix(mixed, haze, smoothstep(0.04, -0.02, el).mul(0.2).add(0.05));
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
export function deepColour(dir, U, tex, { from = 0, shelves = 3, casters = 0 } = {}) {
    const { light } = U;
    const below = max(dir.y.negate(), 0.0).toVar();
    const sink = smoothstep(0.0, 0.45, sqrt(below));
    const haze = horizonHaze(dir, U).toVar();
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
 * @param {number} o.slices   cloud slices (0: none)
 * @param {boolean} o.shower  the passing shower
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
            const lane = smoothstep(0.42, 0.78, texture(tex.noise, vec2(along.mul(5.0 / (2 * Math.PI)).add(0.2), off.mul(2.4))).b);
            const width = core.mul(9.0).sub(17.0);
            // Star clouds: the band is grain, not smoke (whole tiles round it; the level set by
            // hand, since the angle's derivative jumps at its wrap).
            const size = tex.noise.image.width;
            const lod = (tiles) => max(float(0.0), log2(U.pixelAngle.mul((tiles * size) / (2 * Math.PI))));
            const grain = texture(tex.noise, vec2(along.mul(53.0 / (2 * Math.PI)), off.mul(24.0).add(0.6))).level(lod(53)).a;
            // Dust: fine dark filaments threading the band, besides the great rift.
            const dust = smoothstep(0.52, 0.64, texture(tex.noise, vec2(along.mul(11.0 / (2 * Math.PI)).add(0.4), off.mul(5.5)))
                .level(lod(11)).b);
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
    const calm = o.calm ? calmZone(dir, U).toVar() : float(0.0);
    const thetaA = acos(clamp(dot(dir, U.A), -1.0, 1.0)).toVar();

    // ── The anticrepuscular rays: shadow bands in the air, converging on A ──
    if (o.rays) {
        const shade = light.earthShadow.div(max(scMax3(light.earthShadow), 1e-3));
        const rays = antiRays(dir, thetaA, U, tex);
        sky.assign(mix(sky, sky.mul(mix(vec3(1.0), shade, 0.5)).mul(0.5), rays.mul(float(1.0).sub(calm.mul(0.5)))));
    }

    // ── The cirrus, eight kilometres up ──
    if (o.cirrus) {
        const ci = cirrusLayer(dir, up, bearing, thetaA, calm, U, tex);
        sky.assign(mix(sky, ci.xyz, ci.w));
    }

    // ── The altocumulus deck ──
    if (o.slices > 0) {
        const deck = altoDeck(dir, up, bearing, thetaA, calm, U, tex, o.slices);
        sky.assign(mix(sky, deck.colour, deck.cover));
    }

    // ── The Deep: no ground, a luminous haze darkening downward, ragged shelves far below ──
    // (With the cloud sea drawn as a mesh, the dome keeps only the shelves under it.)
    const deep = deepColour(dir, U, tex, {
        from: o.seaMesh ? 1 : 0, shelves: o.shelves, casters: o.seaMesh ? 0 : o.casters,
    });
    const deepMist = deep.mist;
    {
        const haze = horizonHaze(dir, U);
        // Meet the horizon without a seam.
        const seam = smoothstep(0.0, 0.035, below);
        sky.assign(mix(sky, mix(haze, deep.colour, seam), smoothstep(0.0, 0.002, below)));
    }

    // ── Far banks along the horizon, their feet in the mist ──
    if (o.banks) {
        const banks = horizonBanks(dir, bearing, U, tex);
        sky.assign(mix(sky, banks.xyz, banks.w));
    }

    // ── The storm wall far behind the bow's leg; its rain falls on past the horizon ──
    if (o.shower) {
        const wall = stormWall(dir, bearing, U, tex);
        sky.assign(mix(sky, wall.colour, wall.alpha));
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

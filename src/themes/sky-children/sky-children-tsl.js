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
 * secondary bows, the fogbow, the glory with the opposition glow, the sunset and the matched-drop
 * primaries. The bow is a circle round A. It stands, faint, wherever real rain does (the shower,
 * the tower's rain, the falls' spray); the chain paints it stroke by stroke (U.strokes) across the
 * clear sky too, so the sky function carries the stroke masks.
 *
 * `skyColour(dir, U, tex, o)` is the dome; the pools call it again on their mirror ray with fewer
 * layers; stone fades into `horizonHaze`; spray multiplies `opticsAt` by its own density.
 *
 * These builders read uniforms and textures, so they are inline (called inside a material's Fn),
 * never laid-out functions. Only the pure helpers carry setLayout.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, abs, acos, atan, clamp, cos, dot, exp, float, floor, fract, length, max, min, mix, normalize, select, sin,
    smoothstep, sqrt, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { COLOUR_ROWS } from './sky-children-hours.js';
import { OPTICS_ROWS } from './sky-children-core.js';

/** Strokes in the world's table (7 primary + 5 secondary): the rows of each block of U.strokes. */
const STROKE_ROWS = 12;

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
    // Altocumulus, in relief, lit on the faces we see.
    cloudBand: [12, 35], // the elevations (degrees) the field lives in
    cloudScale: 0.00042, // noise tiles per metre of the cloud plane (at 1 km height)
    cloudBase: 0.6, // the density a clear sky needs before a cloud forms
    cloudSoft: 0.1,
    cloudEmboss: 5.5,
    cloudThin: 6, // degrees either side of the primary bow where cloud thins (the bow keeps dark sky)
    // The passing shower: a slate base and its virga, far behind the bow's leg.
    showerBase: 0.06, // the base's elevation (radians)
    showerTop: 0.2,
    // Optics.
    bow: 0.5, // the bow's light against the key's
    fogbowGain: 3.6, // the fogbow's light over the hour's `fogbow` (≈ +10–15 % over the mist's tops)
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
 * The droplet-optics table (OPTICS_ROWS rows × width, RGBA float) as a half-float texture: linear
 * filtering of half floats is core WebGL2 (full floats need an extension phones lack). It repeats
 * vertically so its last row (the matched drops' primary) meets row 0 (the primary) across the
 * wrap; every other read is at a row's centre.
 */
export function createLutTexture(data, width) {
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(data[i], 65000));
    const map = new THREE.DataTexture(half, width, Math.round(data.length / (4 * width)), THREE.RGBAFormat, THREE.HalfFloatType);
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.RepeatWrapping;
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

// ── Optics ──

/** The table at a row and an angle (degrees, over that row's range): rgb light. */
function lut(tex, row, thetaDeg, range) {
    return texture(tex, vec2(clamp(thetaDeg.div(range), 0.0, 1.0), (row + 0.5) / OPTICS_ROWS)).rgb;
}

/**
 * The primary read part way toward the matched drops' row (`toward` 0..1): that row is the
 * table's last, so it lies next to row 0 across the vertical wrap and one fetch between their
 * centres mixes them (the linear filter does the work).
 */
function lutA(tex, thetaDeg, toward) {
    return texture(tex, vec2(clamp(thetaDeg.div(60.0), 0.0, 1.0), float(0.5).sub(toward).div(OPTICS_ROWS))).rgb;
}

/** Where a direction stands round A: φ (0 the bow's lowest point, π its crest). */
const bowPhi = (dir, U) => atan(dot(dir, U.bowRight), dot(dir, U.bowDown));

/**
 * How much of the bow a direction shows, from the strokes the chain has painted: for each of the
 * `count` strokes in the table (vec4 phi0, phi1, progress 0..1, fade 0..1; then the link's colour;
 * then where the painted part's two ends stand and how soft they are, in radians along the stroke
 * from phi0, written by the world each frame), the painted part with its ends ramped. The ramps
 * are symmetric about each end, so two strokes that touch, ramped alike about the same point, add
 * up to exactly one across their joint: no seam, no dark tick. An end in open sky is a brushed
 * end over ~3.5°; an end the card or the HUD hides runs on a little under it; an end at the frame
 * runs out of it. Every end softens by `widen` more (radians, from the caller: the farther onto
 * the bow's bright side, the softer), so the glow a stroke lays on that side tapers off past its
 * ends like a fan, never standing as a pale panel with radial sides. `thread` gathers each link
 * colour's pull away from white over the painted band.
 */
function strokeMask(phi, U, first, count, thread, widen) {
    const band = float(0.0).toVar();
    // A real loop over the strokes (read by index): one copy of the body in the shader, not twelve.
    Loop(count, ({ i }) => {
        const s = U.strokes.element(i.add(first));
        const c = U.strokes.element(i.add(STROKE_ROWS + first));
        const e = U.strokes.element(i.add(2 * STROKE_ROWS + first));
        const sense = select(s.y.lessThan(s.x), float(-1.0), float(1.0));
        const along = scWrapPi(phi.sub(s.x)).mul(sense).toVar();
        const h0 = e.y.add(widen);
        const h1 = e.w.add(widen);
        const painted = smoothstep(e.x.sub(h0), e.x.add(h0), along)
            .mul(float(1.0).sub(smoothstep(e.z.sub(h1), e.z.add(h1), along))).mul(s.w).toVar();
        band.addAssign(painted);
        // The link's colour as a pull away from white (its brightest channel 1), melted by c.w.
        const link = c.xyz.div(max(scMax3(c.xyz), 1e-3));
        thread.addAssign(link.sub(1.0).mul(c.w).mul(painted));
    });
    return band;
}

/**
 * The painted bows along a direction, the stroke work alone (it depends only on where the
 * direction stands round A): vec4(band1, band1, band2, band2) for the primary and the secondary
 * (the pairs kept for the callers that hand them on), each already breathing, and the link
 * colours' pull gathered in `thread` and `thread2`. optics() runs it for each pixel of the sky;
 * the spray and the cumulus run it once per corner of a puff and hand it on (`o.strokes`), since
 * their puffs are too soft for a stroke's end interpolated across one to read any differently.
 */
export function bowStrokes(dir, U, thread, thread2) {
    const phi = bowPhi(dir, U).toVar();
    // Each bow's bright side (inside the primary, outside the secondary): there a stroke's ends
    // soften with the depth, a degree and a bit of arc for each degree in.
    const theta = acos(clamp(dot(dir, U.A), -1.0, 1.0));
    const widen1 = clamp(U.bow.x.sub(theta).mul(1.2), 0.0, 0.35);
    const widen2 = clamp(theta.sub(U.bow.y).mul(1.2), 0.0, 0.35);
    const band1 = strokeMask(phi, U, 0, 7, thread, widen1).toVar();
    const band2 = strokeMask(phi, U, 7, 5, thread2, widen2).toVar();
    // From a chain of ten the bows breathe: a band of light runs round both every 6 s (every 3 s at
    // the cap, where they sing).
    const breathRate = mix(float(1.047), float(2.094), smoothstep(12.5, 13.0, U.bow.w));
    const breath = exp(scWrapPi(phi.sub(U.time.mul(breathRate))).pow2().div(-0.06)).mul(smoothstep(9.5, 10.5, U.bow.w)).mul(0.7);
    return vec4(band1, band1, band2, band2).mul(breath.add(1.0));
}

/**
 * The chain's own drops: as the dial rises, spray lifts into the bow's band where no rain stands
 * (about half the medium at the first links, four fifths at the cap: the chain brings more rain),
 * thicker here and thinner there along the arc, as a real bow is never even.
 */
export function chainVeil(phi, U, tex) {
    const dial = U.bow.w;
    // Whole tiles round the turn (3), so atan's wrap at ±π is seamless.
    const along = texture(tex.noise, vec2(phi.mul(3.0 / (2 * Math.PI)).add(U.drift.x.mul(0.6)), 0.37)).r;
    return smoothstep(0.0, 1.2, dial).mul(mix(float(0.5), float(0.8), smoothstep(3.0, 13.0, dial)))
        .mul(smoothstep(0.3, 0.7, along).mul(0.35).add(0.65));
}

/**
 * The falls' spray seen against the Deep: a soft column round the Mother Fall's plunge
 * (U.sprayColumn: bearing, half width, top and bottom elevation, radians), the real drops the bow
 * stands in below the horizon even at rest.
 */
function sprayColumn(dir, U) {
    const bearing = atan(dir.x, dir.z.negate());
    const off = scWrapPi(bearing.sub(U.sprayColumn.x)).div(max(U.sprayColumn.y, 1e-3));
    const el = dir.y;
    return exp(off.mul(off).negate())
        .mul(smoothstep(U.sprayColumn.w.sub(0.02), U.sprayColumn.w.add(0.04), el))
        .mul(float(1.0).sub(smoothstep(U.sprayColumn.z.sub(0.03), U.sprayColumn.z.add(0.01), el)));
}

/**
 * The droplet optics along a direction, before the drops that carry them: vec4(light, darkening).
 *   rain       the real rain the direction crosses (the shower, the tower's rain, the spray): the
 *              bow stands in it at rest (U.bowRest) and burns full where the chain paints it. In
 *              the Deep (`deep`) only the falls' spray column is real rain under the horizon.
 *   veil       the chain's drops (chainVeil() unless given): the bow shows in it only where painted
 *   rest       a caller's own resting share (the spray's promise of the bow), with U.bowRest's
 *   deep       the Deep's optics too (the fogbow, the opposition glow, the glory) …
 *   deepMist   … on this much mist (the cloud's real cover, 0..1)
 *   strokes    { masks, thread, thread2 } from bowStrokes() run elsewhere (else it runs here)
 */
export function optics(dir, U, tex, o) {
    const { light } = U;
    const mu = clamp(dot(dir, U.A), -1.0, 1.0);
    const theta = acos(mu).toVar(); // radians from A
    const thetaDeg = theta.mul(57.2958).toVar();
    const out = vec3(0.0).toVar();
    const dial = U.bow.w;
    const phi = bowPhi(dir, U).toVar();
    // A long chain (dial 7 and up) burns the bow a quarter brighter at the cap and deepens its
    // colour; past that the bow is made to read by its medium, not by more light.
    const burn = smoothstep(6.5, 13.0, dial);
    const gain = U.bowGain.mul(burn.mul(0.25).add(1.0));
    // The bows' light: the key, but in a low sun's hour (bowSunset) the primary reads the sunset
    // row, which carries the reddened light wavelength by wavelength, so it is lit white there.
    const light1 = mix(light.key, vec3(scMax3(light.key)), U.bowSunset).mul(gain);
    const light2 = light.key.mul(gain);

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
    // One mask for the whole bow, from deep inside out past the red edge (its ends fanning out
    // on the bright side): the glow inside is the same drops' light, but it lifts the sky less the
    // deeper in it lies, so the disc inside never reads as a pale sticker.
    const m1 = masks.x.mul(mix(float(0.3), float(1.0), smoothstep(30.0, 38.5, t1))).toVar();
    const m2 = masks.z;
    // Supernumeraries ring inside the painted primary once the chain holds (dial ≥ 3), fainter
    // than the bow and stronger as it holds: the matched drops' row, mixed in by the same fetch.
    const superGain = smoothstep(2.4, 3.2, dial).mul(min(masks.x, 1.0)).mul(mix(float(0.3), float(0.5), smoothstep(6.0, 13.0, dial)));
    const prim = mix(lutA(tex.lut, t1, superGain), lut(tex.lut, 4, t1, 60.0), U.bowSunset).toVar();
    const sec = lut(tex.lut, 1, t2, 60.0).toVar();
    // Each link's colour stays in the fringes of its own stroke, at low chroma, lit as the bow is.
    const fringes = smoothstep(35.5, 37.0, t1).mul(float(1.0).sub(smoothstep(40.2, 40.9, t1)));
    prim.mulAssign(thread.mul(fringes.mul(0.3)).add(1.0));
    sec.mulAssign(thread2.mul(float(1.0).sub(smoothstep(52.5, 53.5, t2)).mul(smoothstep(51.6, 52.4, t2)).mul(0.25)).add(1.0));
    // The sky inside the bow brightens a little more than the drops alone give.
    prim.mulAssign(float(1.0).add(float(1.0).sub(smoothstep(39.0, 41.5, t1)).mul(0.05)));
    // The colours: the moonbow is all but white; the cap's burn deepens them.
    const sat = U.bowSat.mul(burn.mul(0.1).add(1.0));
    const pv = max(mix(vec3(luma(prim)), prim, sat), vec3(0.0));
    const sv = max(mix(vec3(luma(sec)), sec, sat), vec3(0.0));

    // The media: the real rain, which carries the bow at rest, and the chain's drops, which carry
    // only what it has painted. Under the horizon the chain's drops thin with depth and the only
    // real rain is the falls' spray.
    let { rain } = o;
    let veil = o.veil !== undefined ? o.veil : chainVeil(phi, U, tex);
    if (o.deep) {
        const below = max(dir.y.negate(), 0.0);
        rain = max(rain.mul(smoothstep(-0.01, 0.005, dir.y)), sprayColumn(dir, U));
        veil = veil.mul(mix(float(1.0), mix(float(0.35), float(0.7), exp(below.div(-0.25))), smoothstep(0.0, 0.02, below)));
    }
    rain = clamp(rain, 0.0, 1.0);
    const rest = o.rest !== undefined ? max(U.bowRest, o.rest) : U.bowRest;
    const medium1 = max(rain.mul(max(m1, rest)), veil.mul(m1));
    const medium2 = max(rain.mul(max(m2, rest.mul(0.5))), veil.mul(m2));
    out.addAssign(pv.mul(light1).mul(medium1).mul(TUNE.bow));
    out.addAssign(sv.mul(light2).mul(medium2).mul(TUNE.bow));

    // The brush's head (U.bowHead: φ, which bow, strength, the way it paints; U.bowHeadColour the
    // link's colour): a soft glint riding the band where the stroke is being laid, its colour
    // half the link's, trailing ~6° of arc, fading a moment after the stroke is done.
    {
        const head = U.bowHead;
        const ahead = scWrapPi(phi.sub(head.x)).mul(head.w).toVar();
        const along = exp(ahead.div(0.035).pow2().negate())
            .add(select(ahead.lessThan(0.0), exp(ahead.div(0.1)).mul(0.45), float(0.0)));
        const across = select(head.y.lessThan(0.5), exp(t1.sub(41.3).div(1.1).pow2().negate()), exp(t2.sub(51.8).div(1.3).pow2().negate()));
        const tint = mix(vec3(1.0), U.bowHeadColour.xyz.div(max(scMax3(U.bowHeadColour.xyz), 1e-3)), 0.35);
        const tinted = mix(vec3(luma(tint)), tint, U.bowSat);
        out.addAssign(tinted.mul(light1).mul(along.mul(across).mul(head.z).mul(max(rain, veil)).mul(TUNE.bow * 0.7)));
    }

    // Alexander's band: the sky between the bows darkens once the chain is long (dial ≥ 3, deeper
    // from 7), only where a bow is painted, from the table's own dark band (so it follows R1).
    const between = smoothstep(43.6, 44.8, t1).mul(float(1.0).sub(smoothstep(48.2, 49.4, t2)));
    const alexander = between.mul(smoothstep(2.5, 3.5, dial).mul(0.12).add(smoothstep(6.5, 9.0, dial).mul(0.08)))
        .mul(min(max(masks.x, masks.z), 1.0)).mul(max(rain, veil));
    if (o.deep) {
        const mist = o.deepMist;
        // The fogbow: broad and white on the mist, always there, stronger as the chain holds.
        const tf = theta.div(U.bow.z).mul(39.0);
        const fog = lut(tex.lut, 2, tf, 60.0);
        const fogGain = U.fogbow.mul(TUNE.fogbowGain).mul(smoothstep(2.0, 7.0, dial).add(1.0)).mul(U.bowGain);
        const fogLight = light.key.mul(fogGain).mul(mist);
        out.addAssign(mix(vec3(luma(fog)), fog, U.bowSat.mul(0.3)).mul(fogLight));
        // The opposition glow: the mist's own light brightened round A (a narrow core over a broad
        // skirt), and a set piece's boost.
        const boost = U.glory.z.mul(2.0).add(U.glory.w).mul(TUNE.opposition);
        const opp = exp(thetaDeg.div(-2.5)).mul(0.65).add(exp(thetaDeg.div(-8.0)).mul(0.35)).mul(boost);
        out.addAssign(mix(light.mistLit, light.key, 0.35).mul(opp).mul(mist).mul(U.keyGain.mul(0.22)));
        // The glory: row 3 holds its rings over the opposition glow (taken out again here). Its
        // envelope (the white heart and a broad glow) comes at once; the rings' contrast over it
        // opens ring by ring with a degree of feather, so no disc ever shows a rim.
        const g = lut(tex.lut, 3, thetaDeg, 25.0).sub(exp(thetaDeg.div(-2.5)).mul(0.6)).toVar();
        const envelope = exp(thetaDeg.div(0.6).pow2().negate()).mul(0.8).add(exp(thetaDeg.div(-3.5)).mul(0.22));
        const open = smoothstep(U.glory.y.add(1.0), U.glory.y.sub(0.5), thetaDeg);
        const glory = max(mix(vec3(envelope), g, open), vec3(0.0)).mul(U.glory.x);
        // The rings a little softer in colour than the table (they sit in the mist, not on it).
        out.addAssign(mix(vec3(luma(glory)), glory, 0.72).mul(light.key).mul(TUNE.glory).mul(mist));
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
            const band = exp(off.mul(off).mul(width)).mul(clot.r.mul(1.1).add(0.25)).mul(core.mul(1.6).add(0.55))
                .mul(float(1.0).sub(lane.mul(exp(off.mul(off).mul(-70.0))).mul(0.85)));
            const glow = mix(vec3(0.3, 0.36, 0.6), vec3(0.62, 0.56, 0.6), exp(off.mul(off).mul(-90.0)).mul(clot.b));
            sky.addAssign(glow.mul(band).mul(0.3).mul(dark).mul(U.milky));
            stars.mulAssign(band.mul(2.4).add(1.0));
        }
        sky.addAssign(stars.mul(dark));
    }

    // Where the passing shower stands (its body is drawn after the altocumulus, in front of them).
    const rain = float(0.0).toVar();
    const showerWindow = float(0.0).toVar();
    const showerOff = float(0.0).toVar();
    if (o.shower) {
        showerOff.assign(scWrapPi(bearing.sub(U.shower.x)).div(U.shower.y));
        showerWindow.assign(exp(showerOff.mul(showerOff).mul(-1.2)).mul(U.showerAmt));
    }

    // ── Altocumulus, in relief, the faces we see lit by the sun behind us ──
    if (o.slices > 0) {
        const n = o.slices;
        const band = smoothstep(TUNE.cloudBand[0] * 0.017, TUNE.cloudBand[0] * 0.017 + 0.06, up)
            .mul(float(1.0).sub(smoothstep(TUNE.cloudBand[1] * 0.017, TUNE.cloudBand[1] * 0.017 + 0.12, up)));
        const range = float(1.0).div(up.add(0.12)).toVar();
        const plane = dir.xz.mul(range).toVar();
        const coords = (h) => plane.mul(TUNE.cloudScale * 1000 * h).add(U.drift);
        const mid = coords(1.0).toVar();
        const patch = texture(tex.noise, mid.mul(0.23).add(vec2(0.13, 0.57))).b;
        // The masses: a slow, broad mask (features a quarter of the sky across) leaves clean sky
        // between three or four big banks rather than an even mottle.
        const mass = smoothstep(0.38, 0.66, texture(tex.noise, mid.mul(0.055).add(vec2(0.71, 0.29))).r);
        const need = float(TUNE.cloudBase).sub(U.cloud.mul(0.55)).sub(patch.sub(0.5).mul(0.5))
            .add(float(1.0).sub(mass).mul(0.42))
            .toVar();
        const field = (at) => texture(tex.noise, at).g.mul(0.62).add(texture(tex.noise, at.mul(0.41).add(0.3)).r.mul(0.45));
        // The face toward the sun (toward us): the field thinner toward the light there.
        const keyFlat = normalize(vec2(U.key.x, U.key.z).add(vec2(0.0, 1e-4)));
        const lee = field(mid.add(keyFlat.mul(0.012)));
        const here = field(mid).toVar();
        const facing = clamp(here.sub(lee).mul(TUNE.cloudEmboss).add(0.62), 0.0, 1.0).toVar();
        const transmit = float(1.0).toVar();
        const cloud = vec3(0.0).toVar();
        for (let i = 0; i < n; i++) {
            const f = n > 1 ? i / (n - 1) : 0.5;
            const d = i === 0 ? here : field(coords(1.0 + 0.045 * f));
            const edge0 = need.add(0.1 * f * f);
            const a = smoothstep(edge0, edge0.add(TUNE.cloudSoft), d).toVar();
            const heart = smoothstep(edge0.add(0.1), edge0.add(0.4), d);
            // Three tones: the lit cap a little over the key, the body, the cool shade in its heart.
            const tone = facing.mul(float(1.0).sub(heart.mul(0.45))).add(0.2 * f);
            const colour = mix(light.cloudShade, light.cloudLit.mul(1.12), smoothstep(0.15, 0.95, tone));
            cloud.addAssign(colour.mul(a).mul(transmit));
            transmit.mulAssign(float(1.0).sub(a.mul(0.9)));
        }
        const cover = float(1.0).sub(transmit).toVar();
        // Thin near the bow so it keeps dark sky behind it.
        const thetaB = acos(clamp(dot(dir, U.A), -1.0, 1.0));
        const nearBow = exp(thetaB.sub(U.bow.x).div(TUNE.cloudThin * 0.0175).pow2().negate()).mul(0.6);
        const fog = float(1.0).sub(exp(range.mul(-0.55)));
        const aired = mix(cloud.div(max(cover, 1e-3)), base, fog.mul(0.45));
        // The shower's mass stands in front of the altocumulus behind the bow's leg.
        const clear = float(1.0).sub(nearBow).mul(float(1.0).sub(showerWindow.mul(0.5)));
        sky.assign(mix(sky, aired, cover.mul(band).mul(clear).mul(float(1.0).sub(fog.mul(0.35)))));
    }

    // ── The passing shower: a slate mass far off behind the bow's leg, its rain hanging in curtains ──
    if (o.shower) {
        const sh = U.shower; // x centre bearing, y half width (rad), z base elevation, w unused
        const el = dir.y.toVar();
        const drift = U.drift.x.mul(0.03);
        // The mass: a ragged top (towers along the bearing), a flat dark base, ragged ends.
        const n1 = texture(tex.noise, vec2(bearing.mul(1.7).add(drift), 0.37)).r;
        const window = smoothstep(0.12, 0.55, showerWindow.add(n1.sub(0.5).mul(0.45))).mul(U.showerAmt);
        const n2 = texture(tex.noise, vec2(bearing.mul(5.3).add(drift), el.mul(9.0)).add(0.21)).g.toVar();
        const topEl = sh.z.add(0.07).add(n1.sub(0.5).mul(0.12)).add(exp(showerOff.mul(showerOff).mul(-3.0)).mul(0.07)).toVar();
        const baseEl = sh.z.add(n2.sub(0.5).mul(0.012));
        const body = smoothstep(baseEl.sub(0.008), baseEl.add(0.006), el)
            .mul(float(1.0).sub(smoothstep(topEl.sub(0.035), topEl.add(0.01), el))).toVar();
        // The rain: curtains stretched 1:20 down from the base, thinning to the horizon.
        // Slanted a little with the wind; each column ends at its own height (most never reach
        // the horizon), soft at the end.
        const slant = bearing.add(el.mul(0.15));
        const streak = texture(tex.noise, vec2(slant.mul(23.0).add(drift.mul(3.0)), el.mul(1.1).add(U.mistClock.mul(0.003)))).a
            .mul(0.5).add(texture(tex.noise, vec2(slant.mul(7.0).sub(drift), el.mul(0.35))).r.mul(0.5));
        const colEnd = baseEl.sub(0.02).sub(texture(tex.noise, vec2(slant.mul(11.0), 0.61)).g.mul(0.11));
        const under = float(1.0).sub(smoothstep(baseEl.sub(0.004), baseEl.add(0.004), el));
        const curtain = under.mul(smoothstep(colEnd.sub(0.012), colEnd.add(0.025), el))
            .mul(smoothstep(0.3, 0.75, streak).mul(0.15).add(0.62)).toVar();
        const dark = clamp(body.mul(n2.mul(0.25).add(0.8)).add(curtain.mul(0.8)), 0.0, 1.0).mul(window).toVar();
        // The low sun behind us lights the towers' tops warm; the base and the rain stay slate.
        const litTop = smoothstep(topEl.sub(0.06), topEl, el).mul(body);
        // Rain lit from behind us is a pale veil low down; the towers' tops catch the light.
        const veilLow = float(1.0).sub(smoothstep(0.0, baseEl, el)).mul(curtain).mul(0.5);
        const colour = mix(mix(light.shower, mix(light.cloudShade, light.cloudLit, 0.35), litTop.mul(0.85)), horizonHaze(dir, U), veilLow);
        sky.assign(mix(sky, colour, dark.mul(0.95)));
        // The rain itself carries the bow (the dark makes it burn).
        rain.assign(max(rain, window.mul(under.mul(0.9).add(body.mul(0.45)))));
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

    // ── The droplet optics: the bow in the rain (and in the chain's drops), the fogbow, the glory ──
    if (o.optics) {
        // The Deep's mist as the cloud it really is: the shelves' cover (deep.mist keeps a floor of
        // haze, 1 − transmit·0.55), with a little haze left where no shelf lies.
        const cover = clamp(float(1.0).sub(float(1.0).sub(deepMist).div(0.55)), 0.0, 1.0);
        const mist = max(cover, 0.2).mul(smoothstep(0.0, 0.03, below));
        const opt = optics(dir, U, tex, { rain, deep: true, deepMist: mist }).toVar();
        sky.mulAssign(float(1.0).sub(opt.w));
        sky.addAssign(opt.xyz);
    }
    return sky;
}

export { abs };

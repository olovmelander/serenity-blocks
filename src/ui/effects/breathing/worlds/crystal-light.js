/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Crystal Prism — the light itself, shared by the painted grotto and the traced crystal.
 *
 * One beam of white light reaches the crystal; the crystal sends it on as a fan of wavelengths.
 * The fan is built the way a real prism spectrum forms: every wavelength leaves along its own ray
 * as a band as wide as the beam, and the bands drift apart with distance. Near the crystal they
 * all overlap into white; further out they separate into colour, and the narrower the fan, the
 * longer it stays white — so on the out-breath the colour visibly gathers back into white light.
 *
 * Every function here has a `setLayout` and is pure (values come in as parameters, never as a
 * closed-over uniform): the backdrop calls them for the air and the wet floor, and the crystal's
 * shader calls them several times per fragment for what its facets refract and reflect.
 *
 * Packed parameters, built once per fragment by the callers:
 *   fan  = (centre direction x, y, half-angle in radians, reach in hero units)
 *   look = (band width at the crystal, least divergence, gain, unused)
 *   beam = (travel direction x, y, core width, halo width)
 */
import {
    Fn, cos, dot, exp, float, length, max, mix, normalize, sin, smoothstep, vec2, vec3, vec4,
} from 'three/tsl';
import { fadeOut } from '../stage/breath-tsl.js';

/** Wavelengths per fan: enough that neighbouring bands blend without ripples. */
const FAN_SAMPLES = 9;

/**
 * Linear-RGB colour of a wavelength, t = 0 deep red … 1 violet. Flat-topped bands so yellow and
 * cyan are real colours (not the olive and teal a sum of bumps gives); the samples average close
 * to white, so overlapping bands read as white light.
 */
function spectrumRGB(t) {
    const smooth = (a, b, x) => {
        const s = Math.min(Math.max((x - a) / (b - a), 0), 1);
        return s * s * (3 - 2 * s);
    };
    const r = 1 - smooth(0.24, 0.42, t) + 0.5 * smooth(0.8, 1.0, t);
    const g = smooth(0.12, 0.3, t) * (1 - smooth(0.56, 0.74, t)) * 0.92;
    const b = smooth(0.46, 0.62, t) * (1 - 0.35 * smooth(0.9, 1.05, t));
    return [r, g, b];
}

const SAMPLE_COLORS = Array.from({ length: FAN_SAMPLES }, (_, k) => spectrumRGB(k / (FAN_SAMPLES - 1)));
const SAMPLE_SUM = SAMPLE_COLORS.reduce((sum, c) => sum.map((v, i) => v + c[i]), [0, 0, 0]);
/** Scales the fan so that all bands together (the white core) have unit luminance. */
const WHITE_NORM = 1 / (0.2126 * SAMPLE_SUM[0] + 0.7152 * SAMPLE_SUM[1] + 0.0722 * SAMPLE_SUM[2]);

/**
 * The dispersed fan at `q` (hero units, relative to where the light leaves the crystal).
 * Returns linear RGB in units of the white core's brightness at the crystal.
 */
export const prismFan = /* @__PURE__ */ Fn(([q, fan, look]) => {
    const spread = fan.z.toVar();
    const pitch = spread.mul(2 / (FAN_SAMPLES - 1)).toVar();
    // The red ray leaves on the counter-clockwise edge; each next wavelength turns clockwise.
    const c0 = cos(spread);
    const s0 = sin(spread);
    const ray = vec2(fan.x.mul(c0).sub(fan.y.mul(s0)), fan.x.mul(s0).add(fan.y.mul(c0))).toVar();
    const cs = cos(pitch).toVar();
    const sn = sin(pitch).toVar();
    const r = length(q).toVar();
    // Each band is as wide as the beam, then widens with its share of the fan (so they blend).
    const width = look.x.add(r.mul(max(pitch.mul(0.62), look.y))).toVar();
    const inv = float(1).div(width).toVar();
    const sum = vec3(0).toVar();
    SAMPLE_COLORS.forEach((color, k) => {
        const off = q.y.mul(ray.x).sub(q.x.mul(ray.y)).mul(inv);
        sum.addAssign(vec3(...color).mul(exp(off.mul(off).mul(-0.5))));
        if (k < FAN_SAMPLES - 1) {
            ray.assign(vec2(ray.x.mul(cs).add(ray.y.mul(sn)), ray.y.mul(cs).sub(ray.x.mul(sn))));
        }
    });
    // Light only travels forward, and the fan reaches as far as the breath sends it.
    const along = dot(q, fan.xy);
    const forward = smoothstep(-0.03, 0.05, along);
    const reach = fadeOut(fan.w.mul(0.3), fan.w, r);
    // Spreading: the same light covers a wider band further out.
    return sum.mul(look.x.mul(inv).mul(WHITE_NORM)).mul(forward.mul(reach).mul(look.z));
}).setLayout({
    name: 'prism_fan',
    type: 'vec3',
    inputs: [{ name: 'q', type: 'vec2' }, { name: 'fan', type: 'vec4' }, { name: 'look', type: 'vec4' }],
});

/**
 * The incoming white beam at `q` (relative to the crystal): x = the narrow core, y = the soft
 * halo of light scattered around it. Both end at the crystal.
 */
export const prismBeam = /* @__PURE__ */ Fn(([q, beam]) => {
    const along = dot(q, beam.xy).toVar();
    const across = q.y.mul(beam.x).sub(q.x.mul(beam.y)).toVar();
    // A real beam is never perfectly parallel: it is a little wider where it comes from.
    const core = beam.z.add(along.negate().max(0).mul(0.006)).toVar();
    const halo = beam.w.add(along.negate().max(0).mul(0.05)).toVar();
    const upstream = fadeOut(-0.03, 0.05, along);
    return vec2(
        exp(across.mul(across).div(core.mul(core)).mul(-0.5)),
        exp(across.mul(across).div(halo.mul(halo)).mul(-0.5)),
    ).mul(upstream);
}).setLayout({
    name: 'prism_beam',
    type: 'vec2',
    inputs: [{ name: 'q', type: 'vec2' }, { name: 'beam', type: 'vec4' }],
});

/** The grotto's air colour: deep indigo overhead, a cold teal glow down by the wet floor. */
const AIR_HIGH = vec3(0.003, 0.005, 0.016);
const AIR_LOW = vec3(0.008, 0.026, 0.034);
const WHITE = vec3(1.0, 0.97, 0.94);

/**
 * What the crystal sees along a world direction (camera-aligned: x right, y up, z toward the
 * viewer): the grotto's dark vault and teal floor glow, a band of misty light at eye level, the
 * fan where its light really travels (across the hero plane, to the fan's side — so only facets
 * that bend a view ray that far catch its colour), and the beam's source as a small white-hot
 * patch up the beam (the fire and the glints). Nothing in it is a tiny hard-edged point: a flat
 * facet magnifies whatever it refracts, and a pin-point would come out as a flat block of colour.
 * `sky` = (source gain, haze glow, unused, unused).
 */
export const prismEnvironment = /* @__PURE__ */ Fn(([dir, fan, look, beam, sky]) => {
    const up = dir.y;
    const col = mix(AIR_LOW, AIR_HIGH, smoothstep(-0.45, 0.65, up)).toVar();
    col.addAssign(vec3(0.02, 0.05, 0.06).mul(exp(up.mul(up).mul(-14))).mul(sky.y));
    // The fan, seen from where it starts: colour along the hero plane (z ~ 0) on the fan's side.
    const flat = exp(dir.z.mul(dir.z).mul(-9));
    col.addAssign(prismFan(dir.xy, fan, look).mul(flat).mul(3.5));
    // The source: the beam seen from inside its own path, a tiny white-hot sky with a soft corona.
    const toSource = normalize(vec3(beam.x.negate(), beam.y.negate(), -0.18));
    const facing = dot(dir, toSource).toVar();
    // Bright enough to flare, soft enough that a facet's fire grades through the colours — and wide
    // enough that a turning facet takes more than a second to pass through it (no flashes).
    const sun = exp(facing.sub(1).mul(100)).mul(2.6).add(exp(facing.sub(1).mul(30)).mul(0.45))
        .add(exp(facing.sub(1).mul(8)).mul(0.08));
    col.addAssign(WHITE.mul(sun).mul(sky.x));
    return col;
}).setLayout({
    name: 'prism_environment',
    type: 'vec3',
    inputs: [
        { name: 'dir', type: 'vec3' }, { name: 'fan', type: 'vec4' }, { name: 'look', type: 'vec4' },
        { name: 'beam', type: 'vec4' }, { name: 'sky', type: 'vec4' },
    ],
});

/** Pack the per-fragment parameters (callers build these once, from the world's uniforms). */
export const packFan = (dir, spread, reach) => vec4(dir.x, dir.y, spread, reach);
export const packLook = (width, divergence, gain) => vec4(width, divergence, gain, 0);
export const packBeam = (dir, core, halo) => vec4(dir.x, dir.y, core, halo);
export const packSky = (source, glow) => vec4(source, glow, 0, 0);

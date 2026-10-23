/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Waters — a full moon over a quiet sea at night, seen through a long lens from a few
 * metres above the water.
 * Inhale: the moonlight swells, an ice halo opens round the moon and the moon-path widens into a
 * field of sparkles. Hold: the sea stills. Exhale: the path narrows and dims.
 *
 * The sea is ray-traced, not painted. Every pixel below the horizon is a point on the water
 * plane; its normal comes from a sum of directional waves, from long swell to short ripples, and
 * the view ray is reflected about it into the same sky that is painted above. The moon-path is
 * therefore real glitter: the facets that happen to tilt the moon toward the eye. A wave too fine
 * for its pixel is not drawn; its slope becomes roughness that spreads the reflection instead
 * (LEAN-style filtering), so the far sea is one smooth column, the near sea a scatter of crisp
 * sparkles, and the horizon never aliases — on a tall phone screen as on a wide one. That glitter
 * is dealt out as countless tiny points that come and go, and the nearest of them, too close for
 * a lens focused on the moon, swell into soft bokeh discs.
 *
 * The sky: a moon with the near side's real maria and ray craters, an aureole, a 22° ice halo
 * that opens with the in-breath, stars washed out near the moon, two decks of cloud in
 * perspective with silver edges where they pass the moon, a low cloud bank far out either side of
 * the moon's open horizon, and islands standing in a band of sea mist.
 *
 * Moods (MOODS): the full moon of the poster; a thin crescent under the Milky Way; a harvest moon
 * just risen, amber over a road of gold; a misty night where fog banks roll over the islands and a
 * lighthouse's slow beam turns in them. A far light burns at sea (a boat's lantern, a lamp on the
 * shore) with its column in the water. Now and then a meteor crosses the sky, a fish jumps in the
 * moon-path and its rings spread through the glitter, or a cloud drifts across the moon and the
 * moonlight dims and returns over seconds (timed per visit by `u.seed`, gone under reduced motion).
 */
import {
    Fn, If, cos, dot, exp, float, mix, normalize, reflect, sin, smoothstep, sqrt, step, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, eventWindow, fadeOut, fbm, fresnel, gnoise, hash21, shootingStar, softStep, starfield, voronoi,
    warpedFbm,
} from '../stage/breath-tsl.js';

/** Focal length in hero units (the screen's short half-axis is 1) on a wide screen: a long lens — big moon, long path. */
const LENS = 5;
/** The eye's height above the water, metres. */
const EYE = 3;
/** The horizon as a fraction of the screen height from the bottom (landscape; tall screens show more sea). The moon is the mood's. */
const HORIZON_AT = 0.35;
/** Gaussian pixel filter for the waves, as (k · footprint)² × FILTER: larger is softer and calmer. */
const FILTER = 2.5 / 24;
/** How much of a shown wave's slope turn across one pixel still blurs its glints (anti-aliasing). */
const GLINT_AA = 0.35;
/** The first waves are the long swell; the rest (wind waves, ripples) gusts and warps break up. */
const SWELLS = 4;
/** The moon's radiance in its reflection, and how much of it is dealt out as discrete sparkles of what peak. */
const MOON_GLINT = 6;
const SPARKLE_SHARE = 0.7;
const SPARKLE = 4;

const MOON_HIGHLAND = vec3(1.0, 0.955, 0.87);
const MOON_MARE = vec3(0.64, 0.63, 0.62);
const DEEP = vec3(0.0010, 0.0028, 0.0068);
const SUBSURFACE = vec3(0.003, 0.012, 0.016);
const LAND = vec3(0.0024, 0.0038, 0.0082);

/**
 * The sea's waves, longest first: direction (dx, dz), wavenumber k (rad/m), slope amplitude,
 * angular speed (deep-water dispersion, slowed for sleep) and phase. The long swell rolls toward
 * the eye, so its crests lie along the horizon; shorter waves scatter round the wind, as real
 * ripples do. Golden-angle directions never line up into a grid.
 */
const WAVES = Array.from({ length: 22 }, (_, i) => {
    const t = i / 21;
    const wavelength = 40 * (0.06 / 40) ** t;
    const k = (2 * Math.PI) / wavelength;
    const angle = Math.PI + 0.3 + (0.6 + 1.6 * t) * Math.sin(i * 2.39996 + 0.7);
    return {
        dx: Math.sin(angle),
        dz: Math.cos(angle),
        k,
        // The swell is gentle (a calm night): its long flanks would otherwise band the path into stripes.
        slope: (0.045 + 0.02 * t) * (0.8 + 0.4 * ((i * 0.618034) % 1)) * (i < SWELLS ? 0.45 : 1),
        omega: Math.sqrt(9.81 * k) * 0.15,
        phase: (i * 2.17) % (2 * Math.PI),
    };
});

/** The near side's dark plains, [x, y, rx, ry, weight] on the unit disc (x east, y north), as seen from the north. */
const MARIA = [
    [-0.23, 0.54, 0.31, 0.28, 1.0], // Imbrium
    [0.27, 0.47, 0.18, 0.17, 1.15], // Serenitatis
    [0.49, 0.15, 0.18, 0.22, 1.15], // Tranquillitatis
    [0.84, 0.3, 0.075, 0.14, 1.3], // Crisium
    [0.79, -0.14, 0.13, 0.22, 1.0], // Fecunditatis
    [0.56, -0.26, 0.08, 0.09, 0.8], // Nectaris
    [-0.72, 0.25, 0.22, 0.45, 0.9], // Procellarum
    [-0.51, 0.1, 0.16, 0.16, 0.8], // Insularum
    [-0.27, -0.34, 0.22, 0.17, 0.7], // Nubium
    [-0.39, -0.18, 0.11, 0.09, 0.7], // Cognitum
    [-0.57, -0.41, 0.09, 0.1, 0.72], // Humorum
    [0.0, 0.83, 0.42, 0.055, 0.6], // Frigoris
    [0.06, 0.23, 0.13, 0.06, 0.6], // Vaporum
    [0.0, 0.03, 0.08, 0.06, 0.4], // Sinus Medii
];
/** Bright young craters and their ray systems: [x, y, reach of the rays, brightness, seed]. */
const RAY_CRATERS = [
    [-0.144, -0.686, 0.95, 1.0, 1], // Tycho
    [-0.338, 0.167, 0.45, 0.7, 2], // Copernicus
    [-0.61, 0.14, 0.28, 0.5, 3], // Kepler
    [-0.675, 0.4, 0.12, 0.9, 4], // Aristarchus
    [0.7, 0.277, 0.25, 0.5, 5], // Proclus
];

/** A Lorentzian lobe 1 / (1 + (d/w)²) of a squared distance: soft, long-tailed, and no cusp at d = 0. */
const lorentz = (d2, w) => float(1).div(d2.mul(1 / (w * w)).add(1));

/**
 * A disc of radius `r` (sky units) seen through rough water: spread by a gaussian of (bx, by).
 * A small blur keeps the edge crisp (sparkles); a large one turns it into a soft column whose
 * peak falls as its area grows, so the light it carries stays the same.
 */
function blurredDisc(d, r, bx, by) {
    const r2 = r.mul(r).toVar();
    const ax2 = r2.add(bx.mul(bx).mul(2)).toVar();
    const ay2 = r2.add(by.mul(by).mul(2)).toVar();
    const q2 = d.x.mul(d.x).div(ax2).add(d.y.mul(d.y).div(ay2)).toVar();
    const spread = bx.max(by).div(r).toVar();
    const edge = spread.mul(0.8).add(0.08).min(0.95);
    const crisp = fadeOut(float(1).sub(edge), float(1).add(edge), q2.sqrt());
    const soft = exp(q2.mul(-1.3));
    return mix(crisp, soft, smoothstep(0.25, 1.4, spread)).mul(r2.div(ax2.mul(ay2).sqrt()));
}

/** A glow lobe of width `w` round the moon, spread by the same blur and keeping its light. */
function blurredLobe(d, w, bx, by) {
    const w2 = w.mul(w).toVar();
    const ax2 = w2.add(bx.mul(bx).mul(2)).toVar();
    const ay2 = w2.add(by.mul(by).mul(2)).toVar();
    const q2 = d.x.mul(d.x).div(ax2).add(d.y.mul(d.y).div(ay2));
    return w2.div(ax2.mul(ay2).sqrt()).div(q2.add(1));
}

/** The moon's face at disc point q (|q| <= 1): maria, crater-pocked highlands, ray craters, a faint limb. */
function moonFace(q) {
    const nz = float(1).sub(dot(q, q)).max(0).sqrt()
        .toVar();
    const plains = float(0).toVar();
    MARIA.forEach(([x, y, rx, ry, weight]) => {
        const d = q.sub(vec2(x, y)).div(vec2(rx, ry));
        plains.addAssign(exp(dot(d, d).negate()).mul(weight));
    });
    // Wandering shores: the plains' coastlines meander, but seen from Earth they fade over a
    // little distance rather than ending in an ink line (a hard edge reads as paint, not basalt).
    const ragged = fbm(q.mul(4.2).add(vec2(7.1, 2.3)), 4).sub(0.5).mul(0.4)
        .add(gnoise(q.mul(16).add(vec2(2.9, 6.1))).sub(0.5).mul(0.12));
    const mare = smoothstep(0.3, 0.66, plains.add(ragged)).toVar();
    const grain = fbm(q.mul(9).add(vec2(1.3, 8.2)), 3).toVar();
    // Old highlands are pocked with craters: bright rims, darker floors (no shadows at full moon).
    const pits = voronoi(q.mul(6.5).add(1.7), float(0)).toVar();
    const size = hash21(vec2(pits.z.mul(41), 5.5)).mul(0.22).add(0.2).toVar();
    const rims = smoothstep(size.mul(0.55), size, pits.x).mul(fadeOut(size, size.mul(1.6), pits.x));
    const floors = fadeOut(size.mul(0.2), size.mul(0.9), pits.x);
    const pocks = rims.mul(0.035).sub(floors.mul(0.05)).mul(step(0.55, hash21(vec2(pits.z.mul(17), 9.1))));
    const highland = MOON_HIGHLAND.mul(grain.mul(0.3).add(0.8).add(pocks.mul(float(1).sub(mare))));
    // The plains differ too: some bluish (titanium-rich), some browner.
    const basalt = float(0.97).sub(plains.min(1.4).mul(0.1)).sub(grain.mul(0.18)).mul(1.12);
    const tone = mix(vec3(0.95, 0.97, 1.03), vec3(1.04, 1.0, 0.95), fbm(q.mul(2.3).add(vec2(4.4, 0.6)), 2));
    const albedo = mix(highland, MOON_MARE.mul(tone).mul(basalt), mare).toVar();
    const bright = float(0).toVar();
    RAY_CRATERS.forEach(([x, y, reach, gain, seed]) => {
        const off = q.sub(vec2(x, y)).toVar();
        const d = off.length().max(1e-3).toVar();
        // Rays are a function of direction only (a point on a circle fed to the noise: no seam).
        const dir = off.div(d);
        const streaks = smoothstep(0.5, 0.9, gnoise(dir.mul(2.4).add(seed * 7.3)))
            .add(smoothstep(0.55, 0.9, gnoise(dir.mul(5).add(seed * 3.1))).mul(0.4));
        // The rays start beyond the crater's own bright collar and fade with distance.
        const fall = fadeOut(0, reach, d).mul(smoothstep(0.04, 0.16, d));
        bright.addAssign(streaks.mul(fall).mul(fall).mul(0.26)
            .add(exp(d.mul(d).mul(-1400)).mul(0.9))
            .add(exp(d.mul(d).mul(-260)).mul(0.3))
            .mul(gain));
    });
    // Small fresh craters: bright specks scattered over the highlands.
    const cell = voronoi(q.mul(12).add(3.7), float(0));
    const fresh = smoothstep(0.86, 0.98, hash21(vec2(cell.z.mul(37), 1.3))).mul(exp(cell.x.mul(cell.x).mul(-25)));
    bright.addAssign(fresh.mul(float(1).sub(mare.mul(0.6))).mul(0.16));
    // The full moon is nearly flat-lit: only a whisper of limb darkening.
    const limb = mix(float(0.76), float(1), nz.sqrt());
    return albedo.add(MOON_HIGHLAND.mul(bright).mul(0.5)).mul(limb);
}

/**
 * The versions of this world a visit can show (stage/breath-moods.js); the first is the poster's.
 * `moon`: where it stands (`at`, a fraction of the screen height, or `rise` above the horizon; `x`
 * across), its radius, the colour of its light, its face and its glints, how much light it gives
 * (`gain`), the ice halo (`ring`), and for a crescent how thin it is and where its lit limb faces;
 * `sky`: zenith, horizon, haze and cloud colours; `stars`; `milkyWay`; `clouds` how clear the
 * decks are (0 as drawn, higher thinner); `bank` the low cloud bank; `mist` the band of sea mist
 * on the horizon and `fog` banks of sea fog rolling over it; `beacon`: a far light (a boat's
 * lantern, a lighthouse with a slow beam through fog).
 */
export const MOODS = Object.freeze([
    {
        id: 'full-moon',
        name: 'Full Moon',
        moon: {
            at: 0.67,
            x: 0,
            radius: 0.2,
            light: [0.8, 0.87, 1.0],
            face: [1, 1, 1],
            glint: [1.0, 0.955, 0.87],
            gain: 1,
            ring: 1,
            phase: null,
        },
        sky: {
            zenith: [0.0032, 0.0058, 0.0165],
            horizon: [0.014, 0.022, 0.044],
            haze: [0.026, 0.034, 0.056],
            cloud: [0.009, 0.013, 0.025],
        },
        stars: 0.6,
        milkyWay: false,
        clouds: 0,
        bank: 1,
        mist: 1,
        fog: 0,
        beacon: {
            x: 0.62, e: 0.004, color: [1.0, 0.62, 0.3], gain: 1.1, beam: false,
        },
        grade: {
            shadows: [0.84, 0.94, 1.14],
            highlights: [1.0, 1.0, 1.03],
            saturation: 0.86,
            contrast: 1.05,
            vignette: 0.5,
            chroma: 0.35,
        },
    },
    {
        // A thin crescent low in the west: the sea almost dark, its path a thread of glints, and
        // the Milky Way standing up out of the horizon with its dust lanes.
        id: 'crescent-milky-way',
        name: 'Crescent & Milky Way',
        moon: {
            at: 0.6,
            x: 0.5,
            radius: 0.12,
            light: [0.8, 0.86, 1.0],
            face: [1, 0.98, 0.94],
            glint: [1.0, 0.96, 0.9],
            gain: 0.3,
            ring: 0,
            phase: { thin: 0.74, limb: [0.6, -0.8] },
        },
        sky: {
            zenith: [0.0011, 0.002, 0.0062],
            horizon: [0.005, 0.008, 0.017],
            haze: [0.008, 0.011, 0.02],
            cloud: [0.003, 0.0045, 0.009],
        },
        stars: 1.25,
        milkyWay: true,
        clouds: 0.2,
        bank: 0.6,
        mist: 0.5,
        fog: 0,
        beacon: null,
        grade: {
            shadows: [0.86, 0.94, 1.12],
            highlights: [1.0, 1.0, 1.02],
            saturation: 0.95,
            contrast: 1.06,
            vignette: 0.5,
            chroma: 0.35,
        },
    },
    {
        // A harvest moon just risen: huge and amber through the warm haze low over the sea, its
        // path a road of gold.
        id: 'harvest-moon',
        name: 'Harvest Moon',
        moon: {
            rise: 0.36,
            x: -0.1,
            aureole: 0.35,
            radius: 0.25,
            light: [1.0, 0.64, 0.34],
            face: [1.0, 0.7, 0.42],
            glint: [1.0, 0.72, 0.42],
            gain: 0.85,
            ring: 0,
            phase: null,
        },
        sky: {
            zenith: [0.002, 0.0038, 0.013],
            horizon: [0.019, 0.018, 0.03],
            haze: [0.075, 0.042, 0.022],
            cloud: [0.01, 0.009, 0.014],
        },
        stars: 0.5,
        milkyWay: false,
        clouds: 0.1,
        bank: 0.8,
        mist: 1,
        fog: 0,
        beacon: {
            x: -0.78, e: 0.012, color: [1.0, 0.75, 0.45], gain: 0.35, beam: false,
        },
        grade: {
            shadows: [0.9, 0.93, 1.08],
            highlights: [1.04, 1.0, 0.95],
            saturation: 0.95,
            contrast: 1.05,
            vignette: 0.52,
            chroma: 0.35,
        },
    },
    {
        // A misty night: banks of sea fog roll over the islands under a veiled moon, and a
        // lighthouse's slow beam turns in them.
        id: 'sea-fog',
        name: 'Sea Fog',
        moon: {
            at: 0.72,
            x: 0,
            radius: 0.17,
            light: [0.8, 0.86, 0.96],
            face: [0.96, 0.97, 1.0],
            glint: [0.95, 0.95, 0.92],
            gain: 0.75,
            ring: 0,
            phase: null,
        },
        sky: {
            zenith: [0.005, 0.0075, 0.016],
            horizon: [0.02, 0.026, 0.042],
            haze: [0.034, 0.042, 0.06],
            cloud: [0.012, 0.015, 0.024],
        },
        stars: 0.25,
        milkyWay: false,
        clouds: 0.04,
        bank: 0,
        mist: 1.3,
        fog: 1,
        beacon: {
            x: 0.5, e: 0.028, color: [1.0, 0.82, 0.55], gain: 0.6, beam: true,
        },
        grade: {
            shadows: [0.86, 0.95, 1.1],
            highlights: [1.0, 1.0, 1.02],
            saturation: 0.8,
            contrast: 1.03,
            vignette: 0.5,
            chroma: 0.35,
        },
    },
]);

export function createMoonlitWorld({ u, quality, mood }) {
    const look = MOODS.find((m) => m.id === mood?.id) ?? MOODS[0];
    const { moon } = look;
    const MOONLIGHT = vec3(...moon.light);
    const GLINT = vec3(...moon.glint);
    const ZENITH = vec3(...look.sky.zenith);
    const HORIZON_SKY = vec3(...look.sky.horizon);
    const HAZE = vec3(...look.sky.haze);
    const CLOUD = vec3(...look.sky.cloud);
    const { octaves } = quality;
    // Lighter tiers drop the shortest ripples (their pixels could not show them); the slope those
    // ripples would have added stays, as roughness, so the path keeps its width on every tier.
    const kept = quality.detail >= 0.8 ? WAVES.length : WAVES.length - Math.round((0.8 - quality.detail) * 15);
    const waves = WAVES.slice(0, kept);
    const droppedRoughness = WAVES.slice(kept).reduce((sum, wave) => sum + wave.slope * wave.slope * 0.5, 0);
    // Every wave's slope variance, across and along the view: the path's full breadth on a flat-average sea.
    const SLOPE_VX = WAVES.reduce((sum, wave) => sum + wave.slope * wave.slope * 0.5 * wave.dx * wave.dx, 0);
    const SLOPE_VZ = WAVES.reduce((sum, wave) => sum + wave.slope * wave.slope * 0.5 * wave.dz * wave.dz, 0);

    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const b = u.breathSoft.toVar();
        // Layout follows the screen: the horizon sinks on tall screens (more sea), the moon stays upper-middle.
        const tall = u.ext.y.sub(1).max(0).toVar();
        const bottom = u.ext.y.negate().sub(u.focus).toVar();
        const yh = bottom.add(u.ext.y.mul(2).mul(tall.min(1.2).mul(0.1).add(HORIZON_AT))).toVar();
        // The moon: high over the sea, or (a rising moon) a set height over the horizon.
        const moonY = moon.rise ? yh.add(moon.rise) : bottom.add(u.ext.y.mul(2 * moon.at));
        const moonC = vec2(moon.x, moonY).toVar();
        const radius = tall.mul(0.035).add(moon.radius).mul(b.mul(0.025).add(1)).toVar();
        // Tall screens get a longer lens: the sea at the bottom stays far enough away to keep fine
        // ripples (no magnified blobs), and the moon-path runs all the way down the frame.
        const lens = tall.mul(0.5 * LENS).add(LENS).toVar();
        // The sea's clock slows while the lungs are full: the 7-second hold is the stillest part.
        const seaT = u.time.sub(u.breathInt.mul(0.55)).toVar();
        const visit = u.seed.sub(0.5).toVar();
        // Now and then a cloud drifts across the moon: the moonlight dims and returns over seconds.
        const pass = eventWindow(u.time, float(83), float(26), float(0.7), u.seed.mul(29.9).add(1.3)).toVar();
        const passing = pass.x.mul(u.life).toVar();
        const passY = hash21(vec2(pass.z, 4.1)).sub(0.5).mul(0.4);
        const passAt = vec2(mix(float(-1.7), float(1.7), pass.y), passY).mul(radius)
            .toVar();
        const dim = passing.mul(exp(dot(passAt, passAt).div(radius.mul(radius).mul(1.3)).negate())).mul(0.6).toVar();
        const glow = b.mul(1.0).add(0.5).mul(float(1).sub(dim)).toVar();

        /** The night sky's gradient at elevation e above the horizon (screen units), brighter toward the moon. */
        const skyGradient = (e, x) => {
            const up = e.max(0);
            const base = mix(HORIZON_SKY, ZENITH, float(1).sub(exp(up.mul(-2))));
            const mx = x.sub(moon.x);
            const moonward = exp(mx.mul(mx).mul(-0.8)).mul(0.8).add(0.45);
            return base.add(HAZE.mul(exp(up.mul(-9))).mul(moonward).mul(b.mul(0.3).add(0.85)));
        };

        /** Islands on the horizon, far to near, at sky point (x, elevation); `blur` softens their outline (reflections). */
        const withLand = (color, x, elevation, blur) => {
            // Land stands a little taller on tall screens, where the frame is narrow.
            const stature = tall.mul(0.35).add(1);
            const e = elevation.div(stature).toVar();
            const soft = blur.div(stature).toVar();
            const c = vec3(color).toVar();
            // No land stands higher than this: the rest of the sky, and of its reflection, skips the work.
            If(e.lessThan(soft.add(0.13)), () => {
                const haze = skyGradient(float(0), x);
                const ridge = smoothstep(0.1, 0.7, x).mul(fbm(vec2(x.mul(1.6).add(2.2), 8.1), 2).mul(0.02).add(0.005));
                const islandX = x.sub(u.ext.x.mul(0.5).add(0.15)).div(0.3);
                const island = float(1).sub(islandX.mul(islandX)).max(0).sqrt()
                    .mul(fbm(vec2(x.mul(4).add(9.2), 3.3), 3).mul(0.05).add(0.02));
                const tip = u.ext.x.mul(-0.4).sub(0.18);
                const rise = fadeOut(tip.sub(0.5), tip, x).toVar();
                const headland = rise.sqrt().mul(fbm(vec2(x.mul(2.3).add(4.1), 1.7), 3).mul(0.07).add(0.045))
                    .add(gnoise(vec2(x.mul(70), 5.3)).mul(0.006).mul(rise)).toVar();
                // A far cape behind the headland: layers of land, each paler with distance.
                const capeTip = tip.add(0.42);
                const cape = fadeOut(capeTip.sub(0.7), capeTip, x).sqrt()
                    .mul(fbm(vec2(x.mul(3.1).add(1.3), 6.6), 2).mul(0.022).add(0.01));
                c.assign(mix(c, mix(LAND, haze, 0.84), smoothstep(soft.negate(), soft, ridge.sub(e))));
                c.assign(mix(c, mix(LAND, haze, 0.74), smoothstep(soft.negate(), soft, cape.sub(e))));
                c.assign(mix(c, mix(LAND, haze, 0.66), smoothstep(soft.negate(), soft, island.sub(e))));
                // The headland's crest catches a little moonlight.
                const crest = exp(headland.sub(e).max(0).mul(-260)).mul(0.02);
                const lit = LAND.add(MOONLIGHT.mul(crest).mul(glow));
                c.assign(mix(c, lit, smoothstep(soft.negate(), soft, headland.sub(e))));
            });
            return c;
        };

        /** A band of sea mist lying on the horizon, lit toward the moon (dy: screen units above the horizon). */
        const mist = (x, dy) => {
            const haze = vec3(0).toVar();
            If(dy.abs().lessThan(0.45), () => {
                // Thin above the horizon, deeper over the water (the far sea is foreshortened under it).
                const width = mix(float(0.07), float(0.024), smoothstep(-0.004, 0.004, dy));
                const lay = float(1).div(dy.mul(dy).div(width.mul(width)).add(1)).mul(fadeOut(0.25, 0.45, dy.abs()));
                const drift = fbm(vec2(x.mul(1.3).add(seaT.mul(0.008)), dy.mul(9).add(3.3)), 3);
                const mx = x.sub(moon.x);
                const moonward = exp(mx.mul(mx).mul(-0.9)).mul(1.4).add(0.5);
                haze.assign(HAZE.mul(lay).mul(drift.mul(1.2).add(0.2)).mul(moonward).mul(glow.mul(0.6).add(0.6))
                    .mul(look.mist));
            });
            return haze;
        };

        // A far light: a boat's lantern on the water, a lamp on the shore, a lighthouse on the island.
        // It burns steadily, with only the shimmer of the air over the sea.
        const beaconAt = look.beacon
            ? vec2(u.ext.x.mul(look.beacon.x), yh.add(tall.mul(0.35).add(1).mul(look.beacon.e))).toVar() : null;
        const beaconLight = (q) => {
            const d = q.sub(beaconAt).toVar();
            const d2 = dot(d, d).toVar();
            const core = exp(d2.div(u.px.mul(u.px).mul(3.2)).negate());
            const halo = float(0.05).div(d2.div(0.00025).add(1)).add(float(0.012).div(d2.div(0.004).add(1)));
            const shimmer = sin(u.time.mul(1.3).add(sin(u.time.mul(0.47)).mul(2.5))).mul(0.08).add(0.92);
            return vec3(...look.beacon.color).mul(core.mul(1.5).add(halo)).mul(look.beacon.gain).mul(shimmer);
        };

        const sky = vec3(0).toVar();
        const sea = vec3(0).toVar();
        If(p.y.greaterThan(yh.sub(u.px.mul(2))), () => {
            const e = p.y.sub(yh).max(0).toVar();
            const toMoon = p.sub(moonC).toVar();
            const dist = toMoon.length().toVar();
            const out = dist.sub(radius).max(0).toVar();
            const out2 = out.mul(out).toVar();
            const c = skyGradient(e, p.x).toVar();
            // The aureole and the moonlit air around it; its reach grows with the in-breath as well as
            // its brightness: the moonlight swells.
            const swell = b.mul(0.45).add(0.8);
            const out2s = out2.div(swell.mul(swell));
            const halo = lorentz(out2, 0.035).mul(0.16).add(lorentz(out2s, 0.13).mul(0.07))
                .add(lorentz(out2s, 0.32).mul(0.03))
                .add(lorentz(dist.mul(dist), 0.7).mul(0.022 * (moon.aureole ?? 1)))
                .toVar();
            // In fog the moon wears a broad corona.
            if (look.fog > 0) halo.addAssign(lorentz(out2s, 0.22).mul(0.08 * look.fog));
            c.addAssign(MOONLIGHT.mul(halo).mul(glow).mul(Math.sqrt(moon.gain)));
            // Stars: drowned by moonlight near the moon and by the haze low down.
            const starVeil = smoothstep(0.04, 0.4, e).mul(smoothstep(radius.mul(1.6), radius.mul(6), dist)).toVar();
            if (look.milkyWay) {
                // The Milky Way stands up out of the sea on the left and leans across the sky: a band
                // of unresolved stars split by dark dust lanes, warm and brightest toward its core
                // low over the horizon. Its stars crowd the band.
                const rel = p.sub(vec2(-0.85, yh.sub(0.05)));
                const along = dot(rel, vec2(0.5, 0.866)).toVar();
                const across = dot(rel, vec2(-0.866, 0.5)).toVar();
                const width = along.mul(0.07).add(0.24).toVar();
                const core = exp(across.mul(across).div(width.mul(width)).negate()).toVar();
                const band = vec3(0).toVar();
                If(core.greaterThan(0.004), () => {
                    const mwOctaves = Math.max(3, octaves - 1);
                    const clouds = fbm(vec2(along.mul(2.2), across.mul(4.5)).add(vec2(3.3, visit.mul(5))), mwOctaves);
                    const lanes = fbm(vec2(along.mul(4.4), across.mul(9)).add(9.1), mwOctaves);
                    const dust = smoothstep(0.47, 0.7, lanes)
                        .mul(exp(across.mul(across).div(width.mul(width).mul(0.2)).negate()));
                    const bulge = exp(along.sub(0.25).mul(along.sub(0.25)).mul(-4)).toVar();
                    const light = mix(vec3(0.068, 0.075, 0.1), vec3(0.095, 0.08, 0.064), bulge)
                        .mul(bulge.mul(0.5).add(1));
                    band.assign(light.mul(core).mul(clouds.mul(1.4).sub(0.15).max(0))
                        .mul(float(1).sub(dust.mul(0.85))));
                });
                c.addAssign(band.mul(smoothstep(0.0, 0.12, e)).mul(smoothstep(radius.mul(1.2), radius.mul(4), dist)));
                c.addAssign(starfield(p, u, core.mul(1.1).add(1).mul(0.6 * look.stars)).mul(starVeil));
            } else {
                c.addAssign(starfield(p, u, 0.6 * look.stars).mul(starVeil));
            }
            // Now and then a meteor.
            c.addAssign(shootingStar(p, u, {
                period: 27,
                duration: 1.2,
                chance: 0.6,
                salt: 5.3,
                area: [u.ext.x.mul(-0.85), yh.add(0.5), u.ext.x.mul(0.85), yh.add(1.2)],
                travel: 0.55,
                length: 0.3,
                color: [0.85, 0.92, 1.0],
                gain: 1.1,
            }).mul(starVeil.mul(0.6).add(0.4)));
            if (moon.ring > 0) {
                // A 22 degree ice halo opens with the in-breath: a sharp, faintly red inner edge, a soft blue-white outside.
                const ringR = mix(float(0.34), float(0.6), b).add(tall.mul(0.05)).toVar();
                const dd = dist.sub(ringR).toVar();
                const width = mix(float(0.02), float(0.09), smoothstep(-0.01, 0.01, dd));
                const ring = exp(dd.mul(dd).div(width.mul(width)).negate());
                const veil = gnoise(toMoon.div(dist.max(1e-3)).mul(2.2).add(vec2(seaT.mul(0.003), 4.4))).mul(1.2)
                    .max(0.3);
                const tint = mix(vec3(1.0, 0.78, 0.6), vec3(0.75, 0.86, 1.0), smoothstep(-0.01, 0.07, dd));
                c.addAssign(tint.mul(ring).mul(veil).mul(smoothstep(0.08, 0.85, b)).mul(0.045 * moon.ring));
            }
            // The moon.
            If(dist.lessThan(radius.add(u.px.mul(3))), () => {
                const q = toMoon.div(radius).toVar();
                let face = moonFace(q).mul(vec3(...moon.face)).mul(b.mul(0.12).add(1).mul(0.8));
                if (moon.phase) {
                    // A crescent, lit by the sun below the horizon; the rest of the disc in earthshine.
                    const { thin, limb } = moon.phase;
                    const toLimb = dot(q, vec2(limb[0], limb[1]));
                    const side = dot(q, vec2(-limb[1], limb[0]));
                    const terminator = sqrt(float(1).sub(side.mul(side)).max(0)).mul(thin);
                    const litSide = smoothstep(terminator.sub(0.05), terminator.add(0.05), toLimb);
                    face = mix(c.mul(0.8).add(face.mul(0.012)), face, litSide);
                }
                if (moon.rise) {
                    // Low over the sea its lower limb is dimmer and redder: more air in the way.
                    face = face.mul(mix(vec3(0.72, 0.52, 0.42), vec3(1), smoothstep(-1, 0.6, q.y)));
                }
                c.assign(mix(c, face, softStep(0, radius.sub(dist), u, 1.2)));
            });
            // Two decks of cloud in perspective, thinned round the moon; their thin edges near the
            // moon light up silver with forward-scattered moonlight. Each visit has its own sky.
            const clearing = float(1).sub(exp(dist.mul(dist).div(radius.mul(radius).mul(7)).negate()).mul(0.75));
            const aloft = smoothstep(0.02, 0.22, e).toVar();
            const forward = lorentz(out2, 0.08).mul(1.5).add(lorentz(out2, 0.32).mul(0.3));
            const silver = MOONLIGHT.mul(forward).mul(glow).mul(Math.sqrt(moon.gain)).toVar();
            const deck = (scale, aspect, lift, speed, seed, count) => {
                const depth = float(1).div(e.add(lift));
                const drift = seaT.mul(speed);
                const q = vec2(p.x.mul(depth).mul(aspect), depth.mul(2.4)).mul(scale).add(vec2(drift, seed));
                return warpedFbm(q, drift.mul(0.4).add(seed), count);
            };
            const clear = look.clouds;
            const highSeed = visit.mul(23).add(11.7);
            const lowSeed = visit.mul(17).add(3.1);
            const highField = deck(0.7, 0.5, 0.55, 0.0032, highSeed, Math.max(3, octaves - 1));
            const highDeck = smoothstep(0.5 + clear, 0.82 + clear, highField)
                .mul(clearing).mul(aloft).mul(0.7);
            const lowDeck = smoothstep(0.5 + clear, 0.72 + clear, deck(1.0, 0.9, 0.4, 0.005, lowSeed, octaves))
                .mul(clearing).mul(aloft);
            [highDeck, lowDeck].forEach((density) => {
                const dens = density.toVar();
                const edge = dens.mul(float(1).sub(dens)).mul(4);
                const body = CLOUD.mul(float(1).sub(dens.mul(0.45))).add(silver.mul(edge.mul(0.9).add(0.2)));
                c.assign(mix(c, body, float(1).sub(exp(dens.mul(-2.6)))));
            });
            // The cloud that now and then drifts across the moon: ragged, dark-bodied, silver-rimmed.
            If(passing.greaterThan(0.001), () => {
                // Its billows travel with it; thin parts let the moon glow through.
                const rel = p.sub(moonC.add(passAt)).div(radius.mul(vec2(3.2, 1.1))).toVar();
                const shape = exp(dot(rel, rel).negate());
                const rag = warpedFbm(rel.mul(vec2(2.6, 2.2)).add(vec2(pass.z.mul(30), 1.7)), seaT.mul(0.01), 4);
                const dens = smoothstep(0.38, 0.72, rag).mul(smoothstep(0.08, 0.6, shape)).mul(passing).toVar();
                const edge = dens.mul(float(1).sub(dens)).mul(4);
                const body = CLOUD.mul(float(1).sub(dens.mul(0.45))).add(silver.mul(edge.mul(1.0).add(0.2)));
                c.assign(mix(c, body, float(1).sub(exp(dens.mul(-2.8)))));
            });
            if (look.bank > 0) {
                // A low bank of cloud far out over the sea, either side of the moon's open horizon: dark
                // against the bright haze, translucent, its billowed tops touched with silver toward the moon.
                If(e.lessThan(0.3), () => {
                    const lumps = fbm(vec2(p.x.mul(2.2).add(seaT.mul(0.0025)), 4.7), Math.max(3, octaves - 1))
                        .add(gnoise(vec2(p.x.mul(7.5).add(seaT.mul(0.004)), 1.3)).sub(0.5).mul(0.25));
                    const bx = p.x.sub(moon.x).toVar();
                    const aside = smoothstep(0.28, 0.75, bx.abs()).toVar();
                    const crown = lumps.mul(0.13).add(0.01).mul(aside).toVar();
                    const inside = smoothstep(-0.02, 0.02, crown.sub(e)).mul(aside).toVar();
                    const billow = fbm(vec2(p.x.mul(9), e.mul(26)).add(vec2(seaT.mul(0.006), 3.1)), 3);
                    const moonward = exp(bx.mul(bx).mul(-1.2)).toVar();
                    const crest = exp(crown.sub(e).max(0).mul(-45)).mul(moonward.mul(0.9).add(0.1)).mul(glow);
                    const bank = mix(CLOUD, skyGradient(float(0), p.x), fadeOut(0.002, 0.05, e).mul(0.6))
                        .mul(billow.mul(0.6).add(0.7))
                        .add(MOONLIGHT.mul(crest).mul(0.3));
                    c.assign(mix(c, bank, inside.mul(0.78 * look.bank)));
                });
            }
            sky.assign(withLand(c, p.x, e, u.px.mul(1.2)));
            if (look.beacon) sky.addAssign(beaconLight(p));
        });
        If(p.y.lessThan(yh.add(u.px.mul(2))), () => {
            // The water point under this pixel: a ray from the eye EYE metres up meets the plane.
            const below = yh.sub(p.y).max(u.px.mul(0.7)).toVar();
            const ray = normalize(vec3(p.x, below.negate(), lens)).toVar();
            const reach = float(EYE).div(below).toVar();
            // The breathing camera drifts the eye across the water and leans it in a little.
            const wx = p.x.mul(reach).add(u.pan.x.mul(10)).toVar();
            const wz = reach.mul(lens).add(u.zoom.sub(1).mul(30)).toVar();
            // One pixel's footprint on the water, metres: across, and (much longer) in depth.
            const fx = reach.mul(u.px).toVar();
            const fz = fx.mul(lens).div(below).toVar();
            const fx2 = fx.mul(fx).toVar();
            const fz2 = fz.mul(fz).toVar();
            // Gusts roughen the water in drifting patches (cat's paws), and a slow warp bends the
            // ripples' crests so their sum never settles into a lattice. Both fade to their mean
            // where one pixel already covers more water than they vary over.
            const gq = vec2(wx.mul(1 / 9), wz.mul(1 / 20)).add(vec2(seaT.mul(0.03), seaT.mul(-0.05)));
            const gusty = smoothstep(0.25, 0.75, gnoise(gq)).mul(1.7).add(0.15);
            const gust = mix(float(1), gusty, exp(fz2.mul(-1 / 60))).toVar();
            const wq = vec2(wx, wz.mul(0.6)).mul(1 / 9).add(vec2(seaT.mul(-0.011), 2.7));
            const bend = vec2(gnoise(wq), gnoise(wq.add(vec2(5.2, 1.9)))).sub(0.5).mul(exp(fz2.mul(-1 / 60)).mul(3.2))
                .toVar();
            const sx = float(0).toVar();
            const sz = float(0).toVar();
            const vx = float(0).toVar();
            const vz = float(0).toVar();
            waves.forEach((wave, index) => {
                const ripple = index >= SWELLS;
                const kx = wave.dx * wave.k;
                const kz = wave.dz * wave.k;
                const ax = ripple ? wx.add(bend.x) : wx;
                const az = ripple ? wz.add(bend.y) : wz;
                const phase = ax.mul(kx).add(az.mul(kz)).sub(seaT.mul(wave.omega)).add(wave.phase);
                // The shortest ripples live only where a gust touches the water.
                const touch = Math.min(1, Math.max(0, (index - SWELLS) / (WAVES.length - SWELLS - 4)));
                const amp = ripple ? mix(float(1), gust, touch).mul(wave.slope) : float(wave.slope);
                // The share of this wave a pixel can show (a gaussian pixel filter) ...
                const smear = fx2.mul(kx * kx).add(fz2.mul(kz * kz)).toVar();
                const shown = exp(smear.mul(-FILTER)).toVar();
                const slope = phase.cos().mul(shown).mul(amp).toVar();
                sx.addAssign(slope.mul(wave.dx));
                sz.addAssign(slope.mul(wave.dz));
                // ... and the rest becomes roughness: the part it cannot show, plus how far its slope
                // still turns across one pixel (a glint is far sharper than the wave that makes it).
                const lost = float(1).sub(shown.mul(shown)).mul(0.5).add(shown.mul(shown).mul(smear).mul(GLINT_AA))
                    .mul(amp.mul(amp))
                    .toVar();
                vx.addAssign(lost.mul(wave.dx * wave.dx));
                vz.addAssign(lost.mul(wave.dz * wave.dz));
            });
            // Now and then a fish jumps in the moon-path: a splash where it falls back, then rings
            // spreading over the water. Their slopes tilt the moon into the eye, so the path's
            // glitter traces them. A ring is never finer than the pixel's footprint on the water.
            const splash = float(0).toVar();
            const rings = float(0).toVar();
            const fish = eventWindow(u.time, float(31), float(8), float(0.65), u.seed.mul(43.3).add(7.7)).toVar();
            const jumping = fish.x.mul(u.life).toVar();
            If(jumping.greaterThan(0.001), () => {
                const spotZ = mix(float(22), float(36), hash21(vec2(fish.z, 6.1))).toVar();
                const spot = vec2(spotZ.mul(moon.x).div(lens).add(hash21(vec2(fish.z, 1.9)).sub(0.5).mul(2.4)), spotZ);
                const off = vec2(wx, wz).sub(spot).toVar();
                const d = off.length().max(1e-3).toVar();
                const grow = fish.y.toVar();
                const w = fz.mul(1.2).max(0.5).toVar();
                const ripple = float(0).toVar();
                [[1, 1], [0.64, 0.7], [0.38, 0.45]].forEach(([k, a]) => {
                    const x = d.sub(grow.mul(5.5).add(0.2).mul(k)).div(w).toVar();
                    const crest = exp(x.mul(x).negate()).toVar();
                    ripple.addAssign(x.mul(crest).mul(a));
                    rings.addAssign(crest.mul(a));
                });
                const fade = float(1).sub(grow).toVar();
                const amp = fade.mul(1.2).mul(float(0.5).div(w)).mul(jumping);
                sx.addAssign(ripple.mul(amp).mul(off.x.div(d)));
                sz.addAssign(ripple.mul(amp).mul(off.y.div(d)));
                splash.assign(exp(d.mul(d).div(0.3).negate()).mul(fadeOut(0.04, 0.16, grow)).mul(jumping));
                rings.mulAssign(fade.mul(jumping).mul(float(0.5).div(w)));
            });
            // The sea roughens a touch on the in-breath: more facets find the moon, the path widens.
            const gain = b.mul(0.6).add(0.75).toVar();
            const normal = normalize(vec3(sx.mul(gain).negate(), 1, sz.mul(gain).negate())).toVar();
            const bounce = reflect(ray, normal).toVar();
            // Where the reflected ray meets the painted sky (a ray bounced below the horizon meets the next wave: call it the horizon).
            const fwd = bounce.z.max(0.2);
            const s = vec2(bounce.x.mul(lens).div(fwd), yh.add(bounce.y.max(0.0006).mul(lens).div(fwd))).toVar();
            const er = s.y.sub(yh).toVar();
            // Unresolved slopes blur the reflection: in depth by 2σ, across by 2σ sin(view angle).
            const micro = mix(float(0.006), float(0.016), b);
            const rough = micro.mul(micro).add(droppedRoughness).toVar();
            const bx = vx.add(rough).sqrt().mul(gain).mul(ray.y.negate())
                .mul(lens.mul(2))
                .toVar();
            const by = vz.add(rough).sqrt().mul(gain).mul(lens.mul(2))
                .toVar();
            // The reflected sky: averaged over the blur (the far sea mirrors higher, darker sky too).
            const mirror = skyGradient(er.add(by.mul(0.5)), s.x).toVar();
            const dm = s.sub(moonC).toVar();
            mirror.addAssign(MOONLIGHT.mul(blurredLobe(dm, radius.add(0.05), bx, by).mul(0.12)
                .add(blurredLobe(dm, radius.add(0.16), bx, by).mul(0.05))
                .add(blurredLobe(dm, float(0.6), bx, by).mul(0.022))).mul(glow).mul(Math.sqrt(moon.gain)));
            const shore = withLand(mirror, s.x, er, u.px.mul(1.5).add(by.mul(0.3)));
            const fres = fresnel(dot(ray, normal).negate(), 0.02).toVar();
            const water = DEEP.mul(float(1).sub(fres)).add(shore.mul(fres)).toVar();
            // White water where the fish fell back; the rings' crests catch the moon most in its path.
            const across = p.x.sub(moonC.x).div(radius.mul(1.6));
            const inPath = exp(across.mul(across).negate());
            water.addAssign(GLINT.mul(splash.mul(0.3).add(rings.mul(inPath.mul(0.35).add(0.035)))).mul(glow));
            if (look.beacon) {
                // The far light's reflection: a wavering column of it across the water.
                const lamp = blurredLobe(s.sub(beaconAt), float(0.01), bx, by).mul(look.beacon.gain * 2.5);
                water.addAssign(vec3(...look.beacon.color).mul(lamp).mul(fres));
            }
            // The moon-path. `glitter` is the moonlight the water sends this pixel on average: the
            // share of its facets that tilt the moon's disc into the eye. Real glitter is that light
            // gathered into countless tiny points, so most of it is dealt out as sparkles: a jittered
            // grid of small dashes, each lit with the probability that keeps the average true, and
            // each fading in and out over about a second as the facets come and go.
            const moonPath = radius.mul(b.mul(0.12).add(1)).toVar();
            // 0 at the horizon, 1 at the bottom of the screen.
            const near = smoothstep(0.3, 1.0, below.div(yh.sub(bottom))).toVar();
            // A tall screen looks steeply down at its bottom, where few facets can tilt far enough to
            // catch the moon: lend the near water a little more light so the path runs all the way down.
            const reachDown = near.mul(tall).mul(0.7).add(1);
            const glitter = blurredDisc(dm, moonPath, bx, by).mul(fres).mul(reachDown)
                .mul(b.mul(0.8).add(0.45).mul(MOON_GLINT * moon.gain))
                .mul(float(1).sub(dim))
                .toVar();
            // Where the light is densest the cells fill up, but never into one solid sheet.
            const chance = float(1).sub(exp(glitter.mul(-SPARKLE_SHARE / (0.126 * SPARKLE)))).toVar();
            // Sparkles are sized in screen pixels (never below one device pixel), and the grid's rows
            // deepen toward the viewer: near glints are larger than far ones.
            const unit = u.px.max(1 / 360).toVar();
            If(chance.greaterThan(0.0005), () => {
                const rows = below.div(unit).add(250).toVar();
                const gp = vec2(p.x.div(unit).div(rows.mul(0.017)), rows.log().mul(100));
                const grid = voronoi(gp, seaT.mul(0.25)).toVar();
                const tick = seaT.mul(0.9).add(grid.z.mul(7.3)).toVar();
                const beat = tick.floor();
                const pickNow = hash21(vec2(grid.z.mul(113), beat));
                const pickNext = hash21(vec2(grid.z.mul(113), beat.add(1)));
                const litNow = smoothstep(pickNow, pickNow.add(0.04), chance);
                const litNext = smoothstep(pickNext, pickNext.add(0.04), chance);
                const lit = mix(litNow, litNext, smoothstep(0, 1, tick.fract()));
                const glint = exp(grid.x.mul(grid.x).mul(-20)).mul(hash21(vec2(grid.z.mul(29), 7.7)).mul(0.4).add(0.6));
                const delivered = chance.mul(0.126 * SPARKLE);
                const sheen = glitter.sub(delivered).max(0).mul(0.5);
                water.addAssign(GLINT.mul(sheen.add(glint.mul(lit).mul(SPARKLE))));
            });
            // Out-of-focus glints close to the lens: the long lens is focused on the moon, so the
            // nearest sparkles swell into soft, dim discs that drift in and out over a few seconds.
            // They gather only as the path opens toward the viewer on the in-breath.
            If(near.greaterThan(0.001).and(b.greaterThan(0.25)), () => {
                // The path's broad outline: a flat sea's view of the moon under every slope the waves make.
                const span = gain.mul(gain);
                const bxAll = span.mul(SLOPE_VX).add(rough).sqrt().mul(ray.y.negate())
                    .mul(lens.mul(2));
                const byAll = span.mul(SLOPE_VZ).add(rough).sqrt().mul(lens.mul(2));
                const outline = blurredDisc(vec2(p.x, yh.add(below)).sub(moonC), moonPath, bxAll, byAll);
                const expect = outline.mul(fresnel(ray.y.negate(), 0.02)).mul(glow).mul(moon.gain);
                const cell = voronoi(p.div(0.12), seaT.mul(0.08)).toVar();
                const tick = seaT.mul(0.28).add(cell.z.mul(5.3)).toVar();
                const beat = tick.floor();
                const odds = expect.mul(near).mul(smoothstep(0.25, 0.9, b)).mul(7).min(0.5);
                const pickNow = hash21(vec2(cell.z.mul(71), beat));
                const pickNext = hash21(vec2(cell.z.mul(71), beat.add(1)));
                const onNow = smoothstep(pickNow, pickNow.add(0.05), odds);
                const onNext = smoothstep(pickNext, pickNext.add(0.05), odds);
                const on = mix(onNow, onNext, smoothstep(0, 1, tick.fract()));
                const size = hash21(vec2(cell.z.mul(13), 2.2)).mul(0.1).add(0.3).toVar();
                // A soft disc of light with a faintly brighter rim, as a real lens draws one.
                const rim = smoothstep(size.mul(0.3), size, cell.x).mul(0.35).add(0.65);
                const disc = fadeOut(size.sub(0.07), size.add(0.01), cell.x).mul(rim);
                water.addAssign(GLINT.mul(vec3(0.85, 0.94, 1.15)).mul(disc.mul(on).mul(near).mul(0.24)));
            });
            // A hint of moonlight through the thin crests that face the eye, under the path.
            const wedge = p.x.sub(moonC.x).div(moonC.y.sub(p.y).mul(0.3).add(radius)).toVar();
            const underPath = exp(wedge.mul(wedge).negate());
            water.addAssign(SUBSURFACE.mul(sz.mul(gain).mul(6).saturate()).mul(underPath).mul(glow).mul(0.6));
            // Wisps of mist lying on the far water.
            If(below.lessThan(0.3), () => {
                const lean = below.add(0.06);
                const mq = vec2(p.x.div(lean).mul(0.6), float(0.9).div(lean)).add(vec2(seaT.mul(0.012), 0));
                const wisps = smoothstep(0.5, 0.8, fbm(mq, 3)).mul(fadeOut(0.02, 0.3, below))
                    .mul(smoothstep(0.003, 0.02, below));
                water.addAssign(HAZE.mul(wisps).mul(0.35 + look.fog * 0.6));
            });
            sea.assign(water);
        });
        const col = mix(sea, sky, softStep(yh, p.y, u)).toVar();
        col.addAssign(mist(p.x, p.y.sub(yh)));
        if (look.fog > 0) {
            // Banks of sea fog roll slowly over the islands and the far water, thinning over the near
            // sea; their tops catch the moon.
            const dy = p.y.sub(yh).toVar();
            If(dy.lessThan(0.45).and(dy.greaterThan(-0.6)), () => {
                const drift = seaT.mul(0.006).toVar();
                const ridge = fbm(vec2(p.x.mul(1.3).add(drift).add(visit.mul(7)), 2.2), 3);
                const top = smoothstep(0.3, 0.7, ridge).mul(0.3).add(0.015)
                    .toVar();
                const inside = smoothstep(-0.06, 0.02, top.sub(dy));
                const billow = fbm(vec2(p.x.mul(2.6).add(drift.mul(1.6)), dy.mul(5).sub(drift)).add(5.5), 3);
                const deep = dy.min(0);
                const over = float(1).div(deep.mul(deep).div(0.06).add(1));
                const mx = p.x.sub(moon.x);
                const moonward = exp(mx.mul(mx).mul(-0.7)).mul(0.9).add(0.4).toVar();
                const crest = exp(top.sub(dy).max(0).mul(-30)).mul(moonward);
                const dens = inside.mul(billow.mul(1.1).sub(0.05).saturate()).mul(over).mul(look.fog * 0.8)
                    .min(0.85);
                const fogTint = HAZE.mul(2.6).mul(moonward).mul(glow.mul(0.45).add(0.65))
                    .add(MOONLIGHT.mul(crest).mul(0.03).mul(glow));
                col.assign(mix(col, fogTint, dens));
            });
        }
        if (look.beacon?.beam) {
            // The lighthouse's beam turns slowly through the fog, once in 24 seconds. Its lamp stays
            // steady while the beam swings toward the eye and away: nothing flashes.
            const turn = u.time.mul((Math.PI * 2) / 24).add(visit.mul(9)).toVar();
            const sweep = sin(turn).toVar();
            const facing = cos(turn).mul(0.35).add(0.65);
            const d = p.sub(beaconAt).toVar();
            const spread = d.x.abs().mul(0.07).add(0.006);
            const toward = smoothstep(0, 0.04, d.x.mul(sweep.sign()));
            const reachB = sweep.abs().mul(1.3).add(0.05);
            const beam = exp(d.y.mul(d.y).div(spread.mul(spread)).negate()).mul(exp(d.x.abs().div(reachB).negate()))
                .mul(toward)
                .mul(facing);
            col.addAssign(vec3(...look.beacon.color).mul(beam).mul(0.16 * look.fog));
        }
        // The lamp itself shines through the fog, wearing a wider glow in it.
        if (look.beacon && look.fog > 0) {
            const d = p.sub(beaconAt);
            const glowInFog = float(0.02 * look.fog).div(dot(d, d).div(0.01).add(1));
            col.addAssign(beaconLight(p).mul(0.8).add(vec3(...look.beacon.color).mul(glowInFog)));
        }
        return col;
    })();

    return {
        backdrop,
        bloom: {
            strength: 0.4, radius: 0.72, threshold: 0.86, breath: 0.55,
        },
        grade: look.grade,
        camera: { dolly: 0.02, drift: [0.03, 0.01], period: 80 },
        exposure: 1.0,
    };
}

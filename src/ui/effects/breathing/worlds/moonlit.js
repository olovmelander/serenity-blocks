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
 */
import {
    Fn, If, dot, exp, float, mix, normalize, reflect, smoothstep, step, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, fresnel, gnoise, hash21, softStep, starfield, voronoi, warpedFbm,
} from '../stage/breath-tsl.js';

/** Focal length in hero units (the screen's short half-axis is 1) on a wide screen: a long lens — big moon, long path. */
const LENS = 5;
/** The eye's height above the water, metres. */
const EYE = 3;
/** Screen-height fractions from the bottom: the horizon (landscape; tall screens show more sea) and the moon. */
const HORIZON_AT = 0.35;
const MOON_AT = 0.67;
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

const MOONLIGHT = vec3(0.8, 0.87, 1.0);
const MOON_HIGHLAND = vec3(1.0, 0.955, 0.87);
const MOON_MARE = vec3(0.64, 0.63, 0.62);
const ZENITH = vec3(0.0032, 0.0058, 0.0165);
const HORIZON_SKY = vec3(0.014, 0.022, 0.044);
const HAZE = vec3(0.026, 0.034, 0.056);
const CLOUD = vec3(0.009, 0.013, 0.025);
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

export function createMoonlitWorld({ u, quality }) {
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
        const moonC = vec2(0, bottom.add(u.ext.y.mul(2 * MOON_AT))).toVar();
        const radius = tall.mul(0.035).add(0.2).mul(b.mul(0.025).add(1)).toVar();
        // Tall screens get a longer lens: the sea at the bottom stays far enough away to keep fine
        // ripples (no magnified blobs), and the moon-path runs all the way down the frame.
        const lens = tall.mul(0.5 * LENS).add(LENS).toVar();
        // The sea's clock slows while the lungs are full: the 7-second hold is the stillest part.
        const seaT = u.time.sub(u.breathInt.mul(0.55)).toVar();
        const glow = b.mul(1.0).add(0.5).toVar();

        /** The night sky's gradient at elevation e above the horizon (screen units), brighter toward the moon. */
        const skyGradient = (e, x) => {
            const up = e.max(0);
            const base = mix(HORIZON_SKY, ZENITH, float(1).sub(exp(up.mul(-2))));
            const moonward = exp(x.mul(x).mul(-0.8)).mul(0.8).add(0.45);
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
                const moonward = exp(x.mul(x).mul(-0.9)).mul(1.4).add(0.5);
                haze.assign(HAZE.mul(lay).mul(drift.mul(1.2).add(0.2)).mul(moonward).mul(glow.mul(0.6).add(0.6)));
            });
            return haze;
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
                .add(lorentz(dist.mul(dist), 0.7).mul(0.022))
                .toVar();
            c.addAssign(MOONLIGHT.mul(halo).mul(glow));
            // Stars: drowned by moonlight near the moon and by the haze low down.
            const starVeil = smoothstep(0.04, 0.4, e).mul(smoothstep(radius.mul(1.6), radius.mul(6), dist));
            c.addAssign(starfield(p, u, 0.6).mul(starVeil));
            // A 22° ice halo opens with the in-breath: a sharp, faintly red inner edge, a soft blue-white outside.
            const ringR = mix(float(0.34), float(0.6), b).add(tall.mul(0.05)).toVar();
            const dd = dist.sub(ringR).toVar();
            const width = mix(float(0.02), float(0.09), smoothstep(-0.01, 0.01, dd));
            const ring = exp(dd.mul(dd).div(width.mul(width)).negate());
            const veil = gnoise(toMoon.div(dist.max(1e-3)).mul(2.2).add(vec2(seaT.mul(0.003), 4.4))).mul(1.2).max(0.3);
            const tint = mix(vec3(1.0, 0.78, 0.6), vec3(0.75, 0.86, 1.0), smoothstep(-0.01, 0.07, dd));
            c.addAssign(tint.mul(ring).mul(veil).mul(smoothstep(0.08, 0.85, b)).mul(0.045));
            // The moon.
            If(dist.lessThan(radius.add(u.px.mul(3))), () => {
                const face = moonFace(toMoon.div(radius)).mul(b.mul(0.12).add(1).mul(0.8));
                c.assign(mix(c, face, softStep(0, radius.sub(dist), u, 1.2)));
            });
            // Two decks of cloud in perspective, thinned round the moon; their thin edges near the
            // moon light up silver with forward-scattered moonlight.
            const clearing = float(1).sub(exp(dist.mul(dist).div(radius.mul(radius).mul(7)).negate()).mul(0.75));
            const aloft = smoothstep(0.02, 0.22, e).toVar();
            const forward = lorentz(out2, 0.08).mul(1.5).add(lorentz(out2, 0.32).mul(0.3));
            const silver = MOONLIGHT.mul(forward).mul(glow).toVar();
            const deck = (scale, aspect, lift, speed, seed, count) => {
                const depth = float(1).div(e.add(lift));
                const drift = seaT.mul(speed);
                const q = vec2(p.x.mul(depth).mul(aspect), depth.mul(2.4)).mul(scale).add(vec2(drift, seed));
                return warpedFbm(q, drift.mul(0.4).add(seed), count);
            };
            const highDeck = smoothstep(0.5, 0.82, deck(0.7, 0.5, 0.55, 0.0032, 11.7, Math.max(3, octaves - 1)))
                .mul(clearing).mul(aloft).mul(0.7);
            const lowDeck = smoothstep(0.5, 0.72, deck(1.0, 0.9, 0.4, 0.005, 3.1, octaves)).mul(clearing).mul(aloft);
            [highDeck, lowDeck].forEach((density) => {
                const dens = density.toVar();
                const edge = dens.mul(float(1).sub(dens)).mul(4);
                const body = CLOUD.mul(float(1).sub(dens.mul(0.45))).add(silver.mul(edge.mul(0.9).add(0.2)));
                c.assign(mix(c, body, float(1).sub(exp(dens.mul(-2.6)))));
            });
            // A low bank of cloud far out over the sea, either side of the moon's open horizon: dark
            // against the bright haze, translucent, its billowed tops touched with silver toward the moon.
            If(e.lessThan(0.3), () => {
                const lumps = fbm(vec2(p.x.mul(2.2).add(seaT.mul(0.0025)), 4.7), Math.max(3, octaves - 1))
                    .add(gnoise(vec2(p.x.mul(7.5).add(seaT.mul(0.004)), 1.3)).sub(0.5).mul(0.25));
                const aside = smoothstep(0.28, 0.75, p.x.abs()).toVar();
                const crown = lumps.mul(0.13).add(0.01).mul(aside).toVar();
                const inside = smoothstep(-0.02, 0.02, crown.sub(e)).mul(aside).toVar();
                const billow = fbm(vec2(p.x.mul(9), e.mul(26)).add(vec2(seaT.mul(0.006), 3.1)), 3);
                const moonward = exp(p.x.mul(p.x).mul(-1.2)).toVar();
                const crest = exp(crown.sub(e).max(0).mul(-45)).mul(moonward.mul(0.9).add(0.1)).mul(glow);
                const bank = mix(CLOUD, skyGradient(float(0), p.x), fadeOut(0.002, 0.05, e).mul(0.6))
                    .mul(billow.mul(0.6).add(0.7))
                    .add(MOONLIGHT.mul(crest).mul(0.3));
                c.assign(mix(c, bank, inside.mul(0.78)));
            });
            sky.assign(withLand(c, p.x, e, u.px.mul(1.2)));
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
                .add(blurredLobe(dm, float(0.6), bx, by).mul(0.022))).mul(glow));
            const shore = withLand(mirror, s.x, er, u.px.mul(1.5).add(by.mul(0.3)));
            const fres = fresnel(dot(ray, normal).negate(), 0.02).toVar();
            const water = DEEP.mul(float(1).sub(fres)).add(shore.mul(fres)).toVar();
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
                .mul(b.mul(0.8).add(0.45).mul(MOON_GLINT))
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
                water.addAssign(MOON_HIGHLAND.mul(sheen.add(glint.mul(lit).mul(SPARKLE))));
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
                const expect = outline.mul(fresnel(ray.y.negate(), 0.02)).mul(glow);
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
                water.addAssign(vec3(0.85, 0.9, 1.0).mul(disc.mul(on).mul(near).mul(0.24)));
            });
            // A hint of moonlight through the thin crests that face the eye, under the path.
            const wedge = p.x.div(moonC.y.sub(p.y).mul(0.3).add(radius)).toVar();
            const underPath = exp(wedge.mul(wedge).negate());
            water.addAssign(SUBSURFACE.mul(sz.mul(gain).mul(6).saturate()).mul(underPath).mul(glow).mul(0.6));
            // Wisps of mist lying on the far water.
            If(below.lessThan(0.3), () => {
                const lean = below.add(0.06);
                const mq = vec2(p.x.div(lean).mul(0.6), float(0.9).div(lean)).add(vec2(seaT.mul(0.012), 0));
                const wisps = smoothstep(0.5, 0.8, fbm(mq, 3)).mul(fadeOut(0.02, 0.3, below))
                    .mul(smoothstep(0.003, 0.02, below));
                water.addAssign(HAZE.mul(wisps).mul(0.35));
            });
            sea.assign(water);
        });
        const col = mix(sea, sky, softStep(yh, p.y, u)).toVar();
        col.addAssign(mist(p.x, p.y.sub(yh)));
        return col;
    })();

    return {
        backdrop,
        bloom: {
            strength: 0.4, radius: 0.72, threshold: 0.86, breath: 0.55,
        },
        grade: {
            shadows: [0.84, 0.94, 1.14],
            highlights: [1.0, 1.0, 1.03],
            saturation: 0.86,
            contrast: 1.05,
            vignette: 0.5,
            // Point-like sparkles would fringe toward the corners: keep the lens quiet.
            chroma: 0.35,
        },
        camera: { dolly: 0.02, drift: [0.03, 0.01], period: 80 },
        exposure: 1.0,
    };
}

/**
 * Neon Dusk — the sky dome: dusk gradient, a deep sky that turns (stars sized in pixels, the
 * galaxy's band of far suns), the great setting sun, a ringed planet riding over it, cloud bars
 * burning across it, the lattice of the dome, and the event layers (halos, the neon triangle,
 * the twin suns, laser beams, the sunburst, the scan bar, meteors, a comet).
 *
 * One draw, a function of the view direction only. Drawn AFTER the opaque mountains and floor
 * with the depth test on, so early-Z rejects every pixel they already cover. The glass floor's
 * reflector renders this same dome from the mirrored camera, so the sun, the planet, the clouds
 * and every event all appear in the floor for free.
 *
 * The sun is drawn in the lens's image plane (ndSunDisc), so it stays a circle when the yaw puts
 * it near the frame's edge, and its face is authored saturated and only a little above 1: an
 * orange whose green is high, or a disc far above the tone curve's shoulder, comes out pale peach.
 *
 * Everything that is not always in the sky sits behind a branch on its own uniform (a uniform
 * branch: the whole draw takes one side), so the dusk at rest pays for none of the events.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    atan,
    cameraPosition,
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
    positionWorld,
    pow,
    sin,
    smoothstep,
    sqrt,
    step,
    vec2,
    vec3,
} from 'three/tsl';
import {
    GRID_SPACING,
    ndBodyPlane,
    ndHash21,
    ndHash22,
    ndHazeColor,
    ndLineAA,
    ndNoise2,
    ndSdTriangle,
    ndSkyGradient,
    ndSunAlign,
    ndSunDisc,
    rgb,
} from './neon-dusk-tsl.js';

/** Sky dome radius: beyond everything it must sit behind, inside RIG.far. */
export const SKY_RADIUS = 6000;

/**
 * The sun's face colour for a vertical position v on the disc (−1 bottom … 1 top), from the live
 * mood's five stops (u.mood.sun0 at the base … sun4 at the crown; today: hot magenta, red-orange,
 * molten orange, gold and a pale gold crown). The gradient runs over the part of the disc that
 * clears the pass (v ≳ −0.6). Saturated, with the green low, and only a little above 1, so the
 * tone curve keeps its colour. Inline (it reads uniforms; see ndSkyGradient).
 */
export const ndSunColor = (u, v) => {
    const m = u.mood;
    const t = clamp(v.add(0.62).div(1.62), 0.0, 1.0);
    const c = mix(m.sun0, m.sun1, smoothstep(0.02, 0.3, t)).toVar();
    c.assign(mix(c, m.sun2, smoothstep(0.26, 0.55, t)));
    c.assign(mix(c, m.sun3, smoothstep(0.52, 0.82, t)));
    c.assign(mix(c, m.sun4, smoothstep(0.84, 1.0, t)));
    return c;
};

/**
 * The sun's slits: open bands across the lower face, widening toward the base and sliding slowly
 * down it. `v` = vertical position on the disc, `fw` = its pixel footprint, `phase` = how far
 * they have slid (in stripes: SLITS.speed a second at rest, the world quickens it as play
 * heats). 1 = face, 0 = slit.
 */
export const SLITS = Object.freeze({
    top: 0.34, period: 0.16, widest: 0.6, speed: 0.07,
});
export const ndSunSlits = (v, fw, phase) => {
    const k = 1 / SLITS.period;
    const open = clamp(float(SLITS.top).sub(v).div(SLITS.top + 0.62), 0.0, 1.0);
    const gap = pow(open, 0.85).mul(SLITS.widest);
    const stripe = fract(v.mul(k).add(phase));
    const fs = max(fw.mul(k), 1e-4);
    const face = smoothstep(gap.sub(fs), gap.add(fs), stripe);
    return mix(float(1.0), face, step(0.002, gap));
};

/** A perfect clear's crown: the whole disc burns one saturated gold. */
export const SUN_CROWN = rgb(0xffa21e, 1.3);

/** Gaussian ring at r for slot P = (radius, 1/width, energy, 0). */
const ringTerm = (r, P) => {
    const d = r.sub(P.x).mul(P.y);
    return exp(d.mul(d).negate()).mul(P.z);
};

/**
 * Stratus bars, low to high: elevation (rad), half-thickness (rad), how often a bar breaks along
 * its length (per rad of azimuth), a seed, a drift (rad/s), how much of its length is cloud
 * (the presence threshold: higher = shorter, sparser lenses), and the bearing (rad from the
 * sun's) and reach its streaks gather round: each bar leans to its own side, so together they
 * stagger across the sun instead of ringing it. The low ones cross the slits, the high ones the
 * sun's crown. In the `cloud bars` air (u.cloud) every bar swells and lengthens.
 */
export const STRATUS = Object.freeze([
    {
        e: 0.03, w: 0.0032, f: 2.7, seed: 1.7, drift: 0.0016, cover: 0.44, off: -0.22, reach: 0.36,
    },
    {
        e: 0.056, w: 0.0046, f: 2.1, seed: 4.1, drift: -0.0011, cover: 0.5, off: 0.3, reach: 0.3,
    },
    {
        e: 0.092, w: 0.0058, f: 1.7, seed: 8.3, drift: 0.0013, cover: 0.47, off: -0.06, reach: 0.42,
    },
    {
        e: 0.138, w: 0.0072, f: 1.35, seed: 2.9, drift: -0.0009, cover: 0.53, off: 0.34, reach: 0.3,
    },
    {
        e: 0.2, w: 0.0088, f: 1.1, seed: 6.6, drift: 0.0007, cover: 0.58, off: -0.32, reach: 0.38,
    },
]);

/** How much a bar swells (× its half-thickness) and how much more of its run is cloud, in the cloud air. */
export const CLOUD_SWELL = Object.freeze({ width: 4.2, cover: 0.3, reach: 1.9 });

/**
 * The star lattices, in the sky's own turned frame: cells round the whole turn (a whole number,
 * so the frame's seam falls on a cell wall), the chance a cell holds a star, the power its
 * brightness is dealt by (steep: a handful bright, a dust of faint ones), its light and its image's
 * radius in pixels. The galaxy's band raises the chance (`crowd`).
 */
export const STAR_LAYERS = Object.freeze([
    {
        cells: 700, chance: 0.16, power: 5, gain: 1.5, floor: 0.1, px: 1.0, crowd: 2.6, seed: 0,
    },
    {
        cells: 380, chance: 0.11, power: 8, gain: 3.0, floor: 0.16, px: 1.15, crowd: 1.6, seed: 41,
    },
]);
/** The sparse bright stars, each with a faint four-point flare. */
export const BRIGHT_STARS = Object.freeze({
    cells: 150, chance: 0.1, gain: 2.4, px: 1.45, seed: 97,
});
/** The galaxy's own crowd of faint suns (the tiers that draw it). */
export const BAND_STARS = Object.freeze({
    cells: 1100, chance: 0.5, gain: 1.15, px: 0.95, seed: 163,
});

/**
 * The galaxy in the sky's turned frame (y = the pole): the band is the great circle square to
 * `normal`; `along` and `side` span it. The along-band coordinate is an angle round the band
 * (never a cosine: that stands still at the band's middle and draws every noise cell out into
 * a ray).
 */
const GALAXY = (() => {
    const normal = new THREE.Vector3(0.5, 0.62, 0.6).normalize();
    const along = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0, 1, 0)).normalize();
    const side = new THREE.Vector3().crossVectors(normal, along).normalize();
    return {
        normal, along, side, width: 0.11,
    };
})();
const v3 = (v) => vec3(v.x, v.y, v.z);

/** The ceiling lattice: its height over the lens and its cell (world units). */
export const LATTICE = Object.freeze({ height: 240, cell: GRID_SPACING * 24 });

/** Where the laser beams leave from, in sun radii from the sun's centre: its foot, in the pass. */
export const BEAM_ORIGIN = Object.freeze([0, -0.46]);

/** The most laser beams, and the most meteors, the sky draws at once. */
export const SKY_SLOTS = Object.freeze({ beams: 7, meteors: 10 });

/**
 * A meteor for rows A = (azimuth, elevation, heading, age 0..1) and B = (how far it flies over
 * its life, its tail's length, its light, its width): dead when age ≥ 1. A tail of 0 leaves a
 * moving point (a satellite). Returns its brightness at sky coordinates (az, e).
 */
const meteor = (az, e, A, B, fwA) => {
    const dir = vec2(cos(A.z), sin(A.z));
    const head = vec2(A.x, A.y).add(dir.mul(A.w.mul(B.x)));
    const rel = vec2(az, e).sub(head);
    const along = dot(rel, dir);
    const across = abs(rel.x.mul(dir.y).sub(rel.y.mul(dir.x)));
    const tail = max(B.y, 1e-4);
    const inTail = step(along.negate(), tail).mul(step(along, 0.002));
    const fade = clamp(along.div(tail).add(1.0), 0.0, 1.0);
    const width = max(float(0.0009), fwA.mul(0.8)).mul(B.w);
    const core = float(1.0).sub(smoothstep(width.mul(0.5), width.mul(1.6), across));
    const hd = length(rel).div(width.mul(1.7));
    const point = exp(hd.mul(hd).negate());
    const life = smoothstep(0.0, 0.08, A.w).mul(float(1.0).sub(smoothstep(0.7, 1.0, A.w)));
    return core.mul(inTail).mul(fade.mul(fade)).add(point.mul(0.9)).mul(life)
        .mul(B.z)
        .mul(step(A.w, 1.0));
};

/**
 * @param {object} u  shared world uniforms
 * @param {object} [opts]
 * @param {boolean} [opts.clouds=true]
 * @param {number}  [opts.starDensity=1]  0 disables the stars
 * @param {boolean} [opts.fine=true]      the galaxy's own crowd of faint stars and its dust rift
 */
export function createSky(u, opts = {}) {
    const withClouds = opts.clouds !== false;
    const starDensity = opts.starDensity ?? 1;
    const fine = opts.fine !== false;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NeonDuskSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = true;
    material.fog = false;

    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const e = dir.y.toVar();
        const hLen = max(length(vec2(dir.x, dir.z)), 1e-4);
        const sa = ndSunAlign(dir.z.div(hLen)).toVar();
        const az = atan(dir.x, dir.z.negate()).toVar();
        // Footprints up front: fwidth needs uniform control flow.
        const fwA = max(fwidth(az), 1e-5).toVar();
        const fwE = max(fwidth(e), 1e-6).toVar();
        const col = ndSkyGradient(u, e, sa).toVar();
        const m = u.mood;

        // World angle from the sun (the broad glows) and the disc in the image plane (the face,
        // its slits, the halo hugging its rim and the hologram rings: round on screen).
        const lx = dot(dir, u.sunRight).toVar();
        const ly = dot(dir, u.sunUp).toVar();
        const facing = step(0.0, dot(dir, u.sunDir)).toVar();
        const ang = length(vec2(lx, ly)).toVar();
        const sd = ndSunDisc(u, dir).toVar();
        const r = length(sd).toVar();
        const v = sd.y.toVar();
        const fwR = max(fwidth(r), 1e-5).toVar();
        const fwV = max(fwidth(v), 1e-5).toVar();
        const above = smoothstep(-0.002, 0.0008, e).toVar();
        const pulse = u.sunPulse;
        // The run's end (u.night): the sun has gone down, its glows sink with it, the stars come out.
        const day = float(1.0).sub(u.night.mul(0.72)).toVar();

        // ── The deep sky, in its own turned frame (y = the pole the stars wheel about): the
        // galaxy's band, then the star lattices, every star's image sized in pixels ──
        if (starDensity > 0) {
            const q = u.skyRot.mul(dir).toVar();
            const cosLat = sqrt(max(float(1.0).sub(q.y.mul(q.y)), 1e-3)).toVar();
            const lon = atan(q.x, q.z).toVar();
            const fadeIn = smoothstep(0.06, 0.32, e).mul(float(1.0).sub(sa.mul(0.65))).mul(u.starGain).toVar();

            const across = dot(q, v3(GALAXY.normal)).toVar();
            const bandX = across.div(GALAXY.width);
            const band = exp(bandX.mul(bandX).negate()).toVar();
            const gal = float(0.0).toVar();
            If(band.mul(u.deep).greaterThan(0.004), () => {
                const run = atan(dot(q, v3(GALAXY.side)), dot(q, v3(GALAXY.along))).toVar();
                // Star clouds along the band (a noise stretched under 3:1), with a floor under
                // them so the band stays a band, and one rift of dust down its middle.
                const clouds = ndNoise2(vec2(run.mul(4.4).add(3.0), across.mul(11.0).add(9.0)));
                const light = clouds.mul(0.6).add(0.4).toVar();
                if (fine) {
                    const lane = across.sub(sin(run.mul(3.1)).mul(0.03)).sub(0.012).div(0.034);
                    const torn = ndNoise2(vec2(run.mul(9.0).add(1.7), 7.7)).mul(0.5).add(0.5);
                    light.mulAssign(float(1.0).sub(exp(lane.mul(lane).negate()).mul(torn).mul(0.78)));
                }
                gal.assign(band.mul(light).mul(u.deep));
            });
            const horizonFade = smoothstep(0.03, 0.26, e).mul(float(1.0).sub(sa.mul(0.8)));
            // Its own light: the mood's colour, paler and warmer down its bright middle.
            const heart = band.mul(band);
            col.addAssign(mix(m.galaxy, m.galaxy.add(vec3(0.16, 0.12, 0.14)), heart)
                .mul(gal.mul(band.mul(0.6).add(0.4)).mul(horizonFade).mul(1.7)));

            // One lattice: cells in (longitude, the sine of the latitude), which are equal in
            // area all over the sphere; a star's offset goes cells → radians → pixels.
            const lattice = (cells, seed) => {
                const k = cells / (Math.PI * 2);
                const sp = vec2(lon.mul(k).add(cells), q.y.mul(k).add(cells));
                const cell = floor(sp);
                const h = ndHash22(cell.add(seed));
                const o = fract(sp).sub(h.mul(0.8).add(0.1));
                const off = vec2(o.x.mul(cosLat), o.y.div(cosLat)).div(fwE.mul(k));
                return { cell, h, off };
            };
            const starCol = (h) => mix(
                mix(rgb(0xbfd4ff), rgb(0xffc8f0), smoothstep(0.2, 0.8, h.x)),
                rgb(0xffe6b8),
                step(0.86, h.x),
            );
            for (const L of STAR_LAYERS) {
                const { cell, h, off } = lattice(L.cells, L.seed);
                const chance = min(gal.mul(L.crowd).add(1.0).mul(L.chance * starDensity), 0.85);
                const present = step(float(1.0).sub(chance), ndHash21(cell.add(L.seed + 7.3)));
                const d2 = dot(off, off).div(L.px * L.px);
                const twinkle = sin(u.time.mul(h.x.mul(3.0).add(1.2)).add(h.y.mul(40.0))).mul(0.3).add(0.7);
                const bright = pow(h.y, L.power).mul(L.gain).add(L.floor);
                col.addAssign(starCol(h).mul(exp(d2.negate()).mul(present).mul(twinkle).mul(bright)
                    .mul(fadeIn)));
            }
            {
                // The sparse bright stars: a pixel-sized heart and a faint four-point flare.
                const L = BRIGHT_STARS;
                const { cell, h, off } = lattice(L.cells, L.seed);
                const present = step(1.0 - L.chance * starDensity, ndHash21(cell.add(L.seed + 3.1)));
                const d2 = dot(off, off).div(L.px * L.px);
                const ax = abs(off.x);
                const ay = abs(off.y);
                const flare = exp(ax.mul(-0.16)).mul(exp(ay.mul(-1.5)))
                    .add(exp(ay.mul(-0.16)).mul(exp(ax.mul(-1.5))))
                    .mul(0.3)
                    .mul(step(max(ax, ay), 26.0));
                const twinkle = sin(u.time.mul(h.x.mul(1.7).add(0.6)).add(h.y.mul(30.0))).mul(0.25).add(0.75);
                const bright = h.y.mul(h.y).mul(0.7).add(0.3).mul(L.gain);
                col.addAssign(mix(rgb(0xd8e6ff), rgb(0xffd8f4), h.y).mul(exp(d2.negate()).add(flare))
                    .mul(present).mul(twinkle)
                    .mul(bright)
                    .mul(fadeIn));
            }
            if (fine) {
                // The band's own crowd: sub-pixel suns, their light set for a pixel-wide star.
                const L = BAND_STARS;
                const { cell, h, off } = lattice(L.cells, L.seed);
                const present = step(float(1.0).sub(min(gal.mul(L.chance), 0.7)), ndHash21(cell.add(L.seed + 5.9)));
                const d2 = dot(off, off).div(L.px * L.px);
                col.addAssign(mix(rgb(0xc8d8ff), m.galaxy.mul(2.0), h.x.mul(0.5)).mul(exp(d2.negate())
                    .mul(present).mul(h.y.mul(0.7).add(0.3)).mul(L.gain)
                    .mul(fadeIn)));
            }
        }

        // ── Glow: a broad magenta air round the sun, a warm halo hugging the rim, and a band
        // of light along the horizon. Inside the disc the halo is dim, so the slits show the
        // dusk behind the sun instead of more glare. The haze air widens all of it ──
        const inside = float(1.0).sub(smoothstep(0.92, 1.06, r));
        const wideK = mix(float(-3.4), float(-2.1), u.haze);
        const wide = exp(ang.mul(wideK)).mul(float(0.16).add(pulse.mul(0.3)).add(u.haze.mul(0.1)))
            .mul(facing).toVar();
        const halo = exp(max(r.sub(1.0), 0.0).mul(-2.6)).mul(float(0.42).add(pulse.mul(0.6)))
            .mul(mix(float(1.0), float(0.3), inside)).mul(facing)
            .toVar();
        const glowBand = exp(abs(e).mul(mix(float(-30.0), float(-17.0), u.haze))).mul(exp(abs(lx).mul(-1.8)))
            .mul(float(0.5).add(u.haze.mul(0.25))).mul(facing);
        col.addAssign(m.glowWide.mul(wide).add(m.glowHalo.mul(halo)).add(m.glowBand.mul(glowBand)).mul(day));

        // ── The sunburst: thin rays fanned round the disc, turning slowly. They stand faint in
        // the haze air and in a fever; a quad and a perfect clear throw them across the sky ──
        const theta = atan(sd.y, sd.x).toVar();
        If(u.rays.x.greaterThan(0.002), () => {
            const s1 = sin(theta.mul(9.0).add(u.rays.y));
            const s2 = sin(theta.mul(14.0).sub(u.rays.y.mul(1.6)).add(2.1));
            const s3 = sin(theta.mul(23.0).add(u.rays.y.mul(0.7)).add(4.4));
            const fan = smoothstep(0.45, 1.0, s1).mul(0.5)
                .add(smoothstep(0.7, 1.0, s2).mul(0.32))
                .add(smoothstep(0.82, 1.0, s3).mul(0.18));
            const reach = max(u.rays.z, 0.05);
            const radial = exp(max(r.sub(1.0), 0.0).div(reach).negate()).mul(smoothstep(0.98, 1.25, r));
            col.addAssign(mix(m.glowHalo, m.sun4, 0.45).mul(fan.mul(radial).mul(u.rays.x).mul(facing).mul(day)));
        });

        // ── The sun: a banded gradient disc, its slits widening toward the base. As play heats
        // the face burns toward its gold crown; a perfect clear closes the slits (the crown) ──
        const discMask = float(1.0).sub(smoothstep(float(1.0).sub(fwR), float(1.0).add(fwR), r))
            .mul(facing).mul(above)
            .toVar();
        const slitFace = ndSunSlits(v, fwV, u.slitPhase).toVar();
        const slit = mix(slitFace, float(1.0), u.crown);
        const sunCol = mix(ndSunColor(u, v.add(u.sunHeat.mul(0.25))), SUN_CROWN, u.crown.mul(0.6))
            .mul(float(1.0).add(pulse.mul(0.45))).toVar();
        col.assign(mix(col, sunCol, discMask.mul(slit)));
        // A chain's meter: one slit lights for each step of the combo, from the base up.
        If(u.slitFill.greaterThan(0.01), () => {
            const level = u.slitFill.mul(SLITS.period).sub(0.58);
            const lit = float(1.0).sub(slitFace).mul(discMask)
                .mul(float(1.0).sub(smoothstep(level.sub(0.03), level.add(0.03), v)))
                .mul(clamp(u.slitFill, 0.0, 1.0));
            col.assign(mix(col, mix(u.ridge, vec3(1.0), 0.35).mul(1.5), lit.mul(float(1.0).sub(u.crown))));
        });

        // ── Back-to-back: the sun's twins, a cyan and a magenta ghost sliding out of it and
        // folding back (a rim of light and a faint slitted face each) ──
        If(u.twin.y.greaterThan(0.002), () => {
            const thinG = max(fwR.mul(1.4), 0.011);
            const ghost = (shift, tint) => {
                const p = vec2(sd.x.sub(shift), sd.y);
                const rg = length(p);
                const dr = rg.sub(1.0).div(thinG);
                const rim = exp(dr.mul(dr).negate());
                const faceG = float(1.0).sub(smoothstep(float(1.0).sub(fwR), float(1.0).add(fwR), rg))
                    .mul(ndSunSlits(p.y, fwV, u.slitPhase)).mul(0.16);
                return tint.mul(rim.add(faceG));
            };
            const twins = ghost(u.twin.x.negate(), rgb(0x39f0ff, 2.3)).add(ghost(u.twin.x, rgb(0xff4fd8, 2.3)));
            col.addAssign(twins.mul(u.twin.y).mul(facing).mul(above));
        });

        // ── The ringed planet, riding over the sun: a dark globe with a lit crescent on the
        // side the sun is on, banded where it is lit, and thin bright rings the globe's shadow
        // cuts. Measured along its own world axes, so the glass mirrors the same planet ──
        If(u.planet.z.greaterThan(0.002), () => {
            const pb = ndBodyPlane(dir, u.planetDir, u.planet.x, u.planetEast, u.planetNorth).toVar();
            const pl = pb.xy.toVar();
            const rp = length(pl).toVar();
            If(rp.lessThan(2.7).and(pb.z.greaterThan(0.0)), () => {
                // The pixel in planet radii (no fwidth: this branch is not uniform).
                const pxR = fwE.div(u.planet.x).toVar();
                // Toward the sun, in the same axes.
                const toSun = ndBodyPlane(u.sunDir, u.planetDir, u.planet.x, u.planetEast, u.planetNorth).xy;
                const ls = toSun.div(max(length(toSun), 1e-4)).toVar();
                // The globe: its normal in (east, north, toward the lens).
                const nz = sqrt(max(float(1.0).sub(rp.mul(rp)), 0.0));
                const toward = pl.x.mul(ls.x).add(pl.y.mul(ls.y)).toVar();
                const lit = smoothstep(-0.1, 0.36, toward.mul(0.95).sub(nz.mul(0.22)));
                const bands = sin(pl.y.mul(9.0).add(sin(pl.y.mul(23.0).add(pl.x.mul(1.5))).mul(0.6))).mul(0.5).add(0.5);
                const limb = smoothstep(0.55, 1.0, rp);
                // The night side keeps its bands, faintly, and a thin lit air along its limb.
                const globe = mix(
                    m.planetDark.mul(limb.mul(1.5).add(0.5)).mul(bands.mul(0.5).add(0.75))
                        .add(m.planetBand.mul(smoothstep(0.82, 1.0, rp).mul(0.22))),
                    mix(m.planetLit, m.planetBand, bands.mul(0.6)),
                    lit,
                ).toVar();
                const disc = float(1.0).sub(smoothstep(float(1.0).sub(pxR), float(1.0).add(pxR), rp)).toVar();
                // The rings: an ellipse in the image (opening = u.planet.y), in bands with a gap.
                const open = max(u.planet.y, 0.05);
                const rr = length(vec2(pl.x, pl.y.div(open))).toVar();
                const fwRing = pxR.div(open).mul(1.2).toVar();
                const bandOf = (a, b) => smoothstep(float(a).sub(fwRing), float(a).add(fwRing), rr)
                    .mul(float(1.0).sub(smoothstep(float(b).sub(fwRing), float(b).add(fwRing), rr)));
                const grooves = sin(rr.mul(64.0)).mul(0.18).add(0.82);
                const ringLight = bandOf(1.3, 1.5).mul(0.45).add(bandOf(1.56, 1.94)).add(bandOf(2.02, 2.3).mul(0.6))
                    .mul(grooves)
                    .toVar();
                // The globe's shadow lies on the rings on the side away from the sun.
                const besideAxis = abs(pl.x.mul(ls.y).sub(pl.y.mul(ls.x)));
                const shadow = smoothstep(-0.1, 0.25, toward.negate()).mul(float(1.0).sub(smoothstep(0.85, 1.05, besideAxis)));
                ringLight.mulAssign(float(1.0).sub(shadow.mul(0.86)));
                // The near half of the rings (the south side of the globe) passes in front of it.
                const near = step(pl.y, 0.0).toVar();
                const ringA = ringLight.mul(mix(float(1.0).sub(disc), float(1.0), near)).toVar();
                const show = u.planet.z.mul(above).mul(smoothstep(0.0, 0.05, e)).toVar();
                col.assign(mix(col, globe, disc.mul(float(1.0).sub(ringA.mul(near))).mul(show)));
                col.assign(mix(col, m.ring.mul(u.planet.w), clamp(ringA.mul(0.92), 0.0, 1.0).mul(show)));
            });
        });

        // ── Stratus bars: thin lenses of cloud lying along the horizon, broken along their
        // length, their undersides lit from the sun below them: gold over the sun, hot pink
        // beside it, dark plum bars against the dusk farther out. Over the disc they burn ──
        if (withClouds) {
            If(e.lessThan(0.3), () => {
                const near = clamp(exp(ang.mul(-2.2)).mul(1.15), 0.0, 1.0);
                const litCol = mix(
                    m.cloudLitFar,
                    mix(m.cloudLit, m.cloudLitSun, smoothstep(0.6, 0.95, near)),
                    smoothstep(0.08, 0.55, near),
                ).mul(day);
                const shadeCol = mix(m.cloudShadeFar, m.cloudShadeNear, near);
                // Across the disc a bar stands in FRONT of the sun: it dims the face it covers and
                // glows at its rims, so it reads as cloud, not as a ring passing behind.
                // (the thicker the air's cloud, the darker the bar: a slat across the sun).
                const veil = sunCol.mul(mix(float(0.42), float(0.2), u.cloud)).add(litCol.mul(0.25))
                    .add(shadeCol.mul(u.cloud.mul(0.9)));
                const gather0 = smoothstep(float(0.14).sub(u.cloud.mul(0.1)), 0.6, near);
                const swell = u.cloud.mul(CLOUD_SWELL.width - 1).add(1.0);
                for (const bar of STRATUS) {
                    const lean = az.sub(bar.off).div(u.cloud.mul(CLOUD_SWELL.reach - 1).add(1.0).mul(bar.reach));
                    const gather = gather0.mul(exp(lean.mul(lean).negate()));
                    const a = az.mul(bar.f).add(u.time.mul(bar.drift * bar.f)).add(bar.seed);
                    const n1 = ndNoise2(vec2(a, bar.seed * 3.1));
                    const n2 = ndNoise2(vec2(a.mul(4.7), bar.seed * 5.3 + 11.0));
                    // Each lens tapers to a point at both ends and swells and thins along its run;
                    // the bars gather round the sun and thin out away from it.
                    const cover = float(bar.cover).sub(u.cloud.mul(CLOUD_SWELL.cover));
                    const presence = smoothstep(cover, cover.add(0.3), n1).mul(gather);
                    // The bar wanders up and down along its run (a lens of cloud, not a rule).
                    const centre = n2.sub(0.5).mul(bar.w * 2.6).add(n1.sub(0.5).mul(0.02)).add(bar.e);
                    const halfW = max(pow(presence, 0.7).mul(n2.mul(0.9).add(0.55)).mul(swell).mul(bar.w), 1e-5);
                    const qc = e.sub(centre).div(halfW);
                    const fq = fwE.div(halfW);
                    // Soft through the body, a clean (pixel-wide) edge at the rim; in the cloud
                    // air the bars are slats: solid nearly to their edge.
                    const dens = float(1.0).sub(smoothstep(mix(float(0.3), float(0.8), u.cloud), float(1.0).add(fq), abs(qc)))
                        .mul(step(1e-4, presence));
                    const under = smoothstep(0.55, -0.85, qc);
                    const lit = clamp(under.mul(near.mul(0.75).add(0.25)).add(0.06), 0.0, 1.0);
                    const rimLit = smoothstep(0.35, 0.95, abs(qc));
                    const overSun = mix(veil, sunCol.mul(1.15), rimLit.mul(0.6));
                    const cloudCol = mix(mix(shadeCol, litCol, lit), overSun, discMask);
                    col.assign(mix(col, cloudCol, dens.mul(gather).mul(0.88)));
                }
            });
        }

        // ── The lattice: the dome's own grid shows overhead, a ceiling of neon lines that runs
        // with the floor's and converges on the same horizon ──
        If(u.lattice.greaterThan(0.002), () => {
            const up = max(e, 0.012);
            const reach = float(LATTICE.height).div(up).toVar();
            const gx = dir.x.mul(reach).add(cameraPosition.x).div(LATTICE.cell).toVar();
            const gz = dir.z.mul(reach).add(cameraPosition.z).sub(u.scroll.mul(4.0)).div(LATTICE.cell)
                .toVar();
            const fx = fwidth(gx);
            const fz = fwidth(gz);
            const hw = float(0.01);
            const lineX = ndLineAA(fract(gx.add(0.5)).sub(0.5), hw, fx);
            const lineZ = ndLineAA(fract(gz.add(0.5)).sub(0.5), hw, fz);
            const far = exp(reach.mul(-0.0011));
            const clear = float(1.0).sub(exp(ang.mul(-2.6)).mul(0.92).mul(facing));
            col.addAssign(u.gridFar.mul(max(lineX, lineZ).add(lineX.mul(lineZ).mul(2.0))
                .mul(far).mul(clear)
                .mul(u.lattice)
                .mul(above)
                .mul(1.5)));
        });

        // ── Hologram halos: three pixel-thin dashed circles racing out of the sun's rim, with
        // a faint glow behind them (a double and up, a fever's beat) ──
        const thin = max(fwR.mul(1.3), 0.01).toVar();
        const holo = (P, segs, spin) => {
            const lineAt = (R, a) => {
                const d = r.sub(R).div(thin);
                return exp(d.mul(d).negate()).mul(a);
            };
            const lines = lineAt(P.x, 1.0).add(lineAt(P.x.mul(1.07), 0.55)).add(lineAt(P.x.mul(1.14), 0.3));
            const dash = smoothstep(0.3, 0.42, fract(theta.mul(segs / 6.2832).add(P.x.mul(spin)).add(P.w)));
            return lines.mul(mix(float(0.2), float(1.0), dash)).add(ringTerm(r, P).mul(0.12)).mul(P.z);
        };
        // Event layers run only while an event is live: a uniform branch, so the whole draw
        // takes the same side and the idle sky skips them.
        If(u.holo0.z.add(u.holo1.z).add(u.holo2.z).greaterThan(0.0), () => {
            const rings = rgb(0x39f0ff, 2.4).mul(holo(u.holo0, 48.0, 0.25))
                .add(rgb(0xff5ad8, 2.4).mul(holo(u.holo1, 36.0, -0.25)))
                .add(rgb(0xb46bff, 2.6).mul(holo(u.holo2, 42.0, 0.25)));
            col.addAssign(rings.mul(facing).mul(above));
        });

        // ── A twist: the neon triangle round the sun, spinning home (a line and its echoes) ──
        If(u.tri.z.greaterThan(0.002), () => {
            const ca = cos(u.tri.y);
            const sn = sin(u.tri.y);
            const pt = vec2(sd.x.mul(ca).add(sd.y.mul(sn)), sd.y.mul(ca).sub(sd.x.mul(sn))).toVar();
            const thinT = max(fwR.mul(1.5), 0.012).toVar();
            const edge = (scale, gain) => {
                const d = ndSdTriangle(pt, u.tri.x.mul(scale));
                const k = d.div(thinT);
                return exp(k.mul(k).negate()).add(exp(abs(d).mul(-7.0)).mul(0.14)).mul(gain);
            };
            const lines = edge(1.0, 1.0)
                .add(edge(1.1, 0.55).mul(step(0.5, u.tri.w)))
                .add(edge(1.2, 0.3).mul(step(1.5, u.tri.w)))
                .add(edge(0.9, 0.3).mul(step(2.5, u.tri.w)));
            const tint = mix(rgb(0xff4fd8, 2.4), rgb(0x39f0ff, 2.5), smoothstep(-1.0, 1.8, pt.y));
            col.addAssign(tint.mul(lines).mul(u.tri.z).mul(facing).mul(above));
        });

        // ── Laser beams out of the pass, at the sun's foot (a triple, a quad's crown) ──
        If(u.beamCount.greaterThan(int(0)), () => {
            const rel = sd.sub(vec2(BEAM_ORIGIN[0], BEAM_ORIGIN[1])).toVar();
            const light = vec3(0.0).toVar();
            Loop({
                start: int(0), end: u.beamCount, type: 'int', condition: '<', name: 'b',
            }, ({ b }) => {
                // (angle from straight up, half-width in sun radii, light, hue: 0 cyan, 1 magenta, 2 gold)
                const B = u.beams.element(b).toVar();
                const bx = sin(B.x);
                const by = cos(B.x);
                const along = rel.x.mul(bx).add(rel.y.mul(by)).toVar();
                const across = abs(rel.x.mul(by).sub(rel.y.mul(bx))).toVar();
                const w = max(B.y.mul(max(along, 0.0).mul(0.05).add(1.0)), fwR.mul(1.2)).toVar();
                const k = across.div(w);
                const core = exp(k.mul(k).negate());
                const glow = exp(across.div(w.mul(5.0)).negate()).mul(0.2);
                const run = exp(max(along, 0.0).mul(-0.085)).mul(smoothstep(0.0, 0.7, along));
                const tint = mix(
                    mix(rgb(0x39f0ff, 2.6), rgb(0xff4fd8, 2.6), clamp(B.w, 0.0, 1.0)),
                    rgb(0xffc640, 2.6),
                    clamp(B.w.sub(1.0), 0.0, 1.0),
                );
                light.addAssign(tint.mul(core.add(glow).mul(run).mul(B.z)));
            });
            col.addAssign(light.mul(facing).mul(above));
        });

        // ── A level: the scan bar climbs the sky, a wake of light under it ──
        If(u.scan.y.greaterThan(0.002), () => {
            const d = e.sub(u.scan.x).toVar();
            const k = d.div(max(fwE.mul(1.6), 0.0034));
            const bar = exp(k.mul(k).negate());
            const wake = exp(min(d, 0.0).mul(11.0)).mul(step(d, 0.0)).mul(sin(e.mul(520.0)).mul(0.2).add(0.8)).mul(0.2);
            col.addAssign(mix(u.ridge, vec3(1.6), 0.4).mul(bar.mul(1.5)).add(m.glowWide.mul(wake))
                .mul(u.scan.y)
                .mul(above));
        });

        // ── Meteors (a cascade's volley, a fever's shower, a happening, now and then one at
        // rest) and satellites: rows packed at the front ──
        If(u.shootCount.greaterThan(int(0)), () => {
            const stars = float(0.0).toVar();
            Loop({
                start: int(0), end: u.shootCount, type: 'int', condition: '<', name: 's',
            }, ({ s }) => {
                const A = u.shoots.element(s.mul(2)).toVar();
                const B = u.shoots.element(s.mul(2).add(1)).toVar();
                stars.addAssign(meteor(az, e, A, B, fwA));
            });
            col.addAssign(rgb(0xd8f4ff, 3.0).mul(min(stars, 1.6)).mul(above));
        });

        // ── A comet: a point of a head, a broad bent tail of dust and a thin straight one ──
        If(u.comet.w.greaterThan(0.002), () => {
            const rel = vec2(az, e).sub(u.comet.xy).toVar();
            const t = vec2(cos(u.comet.z), sin(u.comet.z)).toVar();
            const s = dot(rel, t).toVar();
            const x = rel.x.mul(t.y).sub(rel.y.mul(t.x)).toVar();
            const dHead = length(rel).toVar();
            const px = max(fwE, 0.0006);
            const hk = dHead.div(px.mul(1.7));
            const head = exp(hk.mul(hk).negate()).mul(1.8).add(exp(dHead.div(-0.007)).mul(0.4));
            const sPos = max(s, 0.0).toVar();
            const dustW = sPos.mul(0.2).add(0.0038);
            const dustX = x.sub(sPos.mul(sPos).mul(0.9)).div(dustW);
            const dust = exp(dustX.mul(dustX).negate()).mul(exp(sPos.div(-0.085))).mul(smoothstep(-0.002, 0.006, s));
            const ionX = x.div(sPos.mul(0.03).add(0.0017));
            const ion = exp(ionX.mul(ionX).negate()).mul(exp(sPos.div(-0.13))).mul(smoothstep(-0.001, 0.004, s));
            const light = rgb(0xfff0d8).mul(head).add(rgb(0xffd0b0).mul(dust.mul(0.5))).add(rgb(0x7ad8ff).mul(ion.mul(0.6)));
            col.addAssign(light.mul(u.comet.w).mul(above).mul(smoothstep(0.03, 0.14, e)));
        });

        return mix(ndHazeColor(u, sa), col, above);
    })();

    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NeonDuskSkyDome';
    mesh.renderOrder = 50;
    mesh.frustumCulled = false;
    return mesh;
}

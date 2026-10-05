/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Ocean Tide — a tropical shoreline at golden hour, seen from a drone hanging over the beach and
 * looking out to sea, into the low sun. Inhale: a wave sweeps up the sand toward you, its white
 * bore churning. Exhale: it slides back out, leaving the sand glossy with a film that mirrors the
 * sky, laced with foam and bubbles, while the next wave breaks offshore and rolls in to meet it.
 *
 * The frame is a pitched virtual camera over one ground plane: screen points are cast onto the
 * ground, so the far sea is compressed toward the top of the frame and the near sand is large at
 * the bottom (tall screens see farther, out to a fringing reef with its surf and the open ocean).
 * Everything is shaded in ground coordinates: a beach that shelves into a lagoon, a swash front
 * driven by the breath along that slope, water coloured by Beer–Lambert absorption over its depth
 * (turquoise shallows over white sand, rich blue farther out), the bed seen through the moving
 * surface with caustics dancing on it, a Fresnel reflection of the golden-hour sky that grows
 * toward the grazing top of the frame, and the sun's glitter: chop facets near by, merging into a
 * glowing, swell-banded path far off. Foam is a web of round holes that open as it thins: dense
 * at the bore, pulled into streamers behind it, a ribbon at the water's edge. The dry beach takes
 * the raking light on its berm, hummocks and wind-ripple fields; quartz grains spark. Soft cloud
 * shadows drift over it all, and every fine pattern bows out before the distance would alias it.
 *
 * Ground units: about twelve metres each. The landscape frame spans some forty metres of beach.
 */
import {
    Fn, clamp, dot, exp, float, mix, normalize, pow, reflect, smoothstep, step, uniform, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, fresnel, gnoise, gnoise3, hash21, hash22, layer, voronoi,
} from '../stage/breath-tsl.js';

const TAU = Math.PI * 2;
/**
 * The drone's lens. HORIZON: how far above the hero the (unseen) horizon would sit on screen,
 * landscape and portrait — the lower it is, the stronger the perspective. PITCH: how steeply the
 * lens looks down through the hero, radians below the horizontal.
 */
const HORIZON = [2.4, 3.2];
const PITCH = 0.72;
const SIN_PITCH = Math.sin(PITCH);
const COS_PITCH = Math.cos(PITCH);
const FOCAL = (COS_PITCH * COS_PITCH) / SIN_PITCH;
/** The low sun, ahead of the lens and a little to the right: elevation and azimuth, radians. */
const SUN_ELEVATION = 0.36;
const SUN_AZIMUTH = 0.34;
const SUN_DIR = [
    Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
    Math.sin(SUN_ELEVATION),
    Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
];
/**
 * The beach on the ground plane (landscape, portrait): the waterline turns this far from the
 * screen's horizontal (sea to the upper right) and crosses the view's axis this far ahead of the
 * hero; it bends into a shallow bay.
 */
const SHORE_TILT = [0.2, 0.3];
const SHORE_AHEAD = [0.0, 0.28];
const BAY = 0.04;
/** The swash front, seaward of the mean waterline: lungs empty, and lungs full (landscape, portrait). */
const REACH_EMPTY = 0.3;
const REACH_FULL = [-0.6, -1.12];
/** Where the next wave breaks offshore, as the out-breath begins. */
const BREAK_LINE = 1.9;
/** The fringing reef, this far out: tall frames see it near the top, with the open ocean beyond. */
const REEF = 2.9;

const SUNLIGHT = vec3(1.0, 0.76, 0.5);
const SKYLIGHT = vec3(0.34, 0.48, 0.7);
const SKY_GOLD = vec3(1.15, 0.78, 0.44);
const SKY_ROSE = vec3(0.5, 0.46, 0.62);
const SKY_HIGH = vec3(0.24, 0.4, 0.74);
const SAND = vec3(0.8, 0.66, 0.5);
const BED = vec3(0.86, 0.84, 0.74);
const WEED = vec3(0.06, 0.09, 0.06);
const ABSORB = vec3(3.0, 0.6, 0.33);
const DEEP = vec3(0.0, 0.065, 0.23);
const FOAM = vec3(1.0, 0.98, 0.96);
const HAZE = vec3(0.92, 0.76, 0.6);
const SUN_POWER = 2.4;
const GLINT = 40;

/** x² as a product: no pow() of a base that may dip below zero. */
const sq = (x) => x.mul(x);

/**
 * 1 while a pattern of this wavelength (ground units) spans several pixels, fading to 0 before it
 * would shimmer: far ground is compressed, so its fine detail must bow out.
 */
const resolve = (foot, wavelength) => fadeOut(0.16, 0.38, foot.div(wavelength));

/** Golden-hour sky along a direction (y up): warm and bright toward the low sun, clear blue overhead. */
function skyRadiance(dir, sun) {
    const up = dir.y.max(0);
    const toward = dot(dir, sun).max(0).toVar();
    const t2 = sq(toward);
    const t8 = sq(sq(t2));
    const t32 = sq(sq(t8));
    // Golden hour: the low sky is gold toward the sun and rose away from it; blue overhead.
    const low = mix(SKY_ROSE, SKY_GOLD, t2);
    return mix(low, SKY_HIGH, smoothstep(0.03, 0.8, up).mul(float(1).sub(t2.mul(0.45))))
        .add(SUNLIGHT.mul(t8.mul(0.45).add(t32.mul(1.5))));
}

/**
 * Caustic threads for the lighter tiers: the zero lines of two drifting noise fields, which wind
 * into closed loops like light focused by a moving surface (and never into straight-edged cells).
 */
function causticThreads(point, time) {
    const a = gnoise(point.mul(0.62).add(vec2(time.mul(0.1), time.mul(-0.07))));
    const b = gnoise(point.mul(vec2(0.48, 0.71)).add(vec2(5.2, 1.3)).sub(vec2(time.mul(0.06), time.mul(0.09))));
    return exp(sq(a.sub(0.5)).mul(-160)).add(exp(sq(b.sub(0.5)).mul(-160))).mul(0.85);
}

/** A caustic net: soft bright lines where the walls of drifting, strongly warped cells run thin. */
function causticNet(point, time, speed) {
    const at = point.mul(0.45);
    const warp = vec2(gnoise(at.add(time.mul(0.12))), gnoise(at.add(vec2(4.3, 1.9)).sub(time.mul(0.1))));
    const cells = voronoi(point.add(warp.mul(1.6)), time.mul(speed));
    const wall = cells.y.sub(cells.x);
    return exp(sq(wall).mul(-38));
}

/**
 * Foam lace: white filaments between round holes where bubble rafts have burst open. `radius` is
 * the holes' size in cells (about 0.15: dense foam, a few pin-holes; 0.5: a torn web of threads).
 * Returns the web's coverage and the nearest cell (for bubbles).
 */
function foamWeb(point, time, radius) {
    // Warped at the scale of the cells themselves, so no hole is a circle.
    const bend = vec2(gnoise(point.mul(0.55)), gnoise(point.mul(0.55).add(vec2(3.7, 8.1)))).sub(0.5).mul(0.9);
    const cells = voronoi(point.add(bend), time).toVar();
    const hole = hash21(vec2(cells.z.mul(37), 1.3)).mul(0.35).add(0.75).mul(radius);
    return { web: smoothstep(hole, hole.add(0.05), cells.x), cells };
}

export function createOceanWorld({ u, quality }) {
    const { octaves, detail } = quality;
    const fine = detail >= 0.6;
    // The swash as the breath drives it (set in update). `uBore`: how much fresh white water the
    // wave carries. `uLace`: how much older lace rides the water, left by the uprush. `uOut`: 0 while
    // the wave runs up the sand, easing to 1 once the out-breath has begun (the sand drains and the
    // next wave rolls in from the break). `uIncoming` is the same switch without the easing: it moves
    // the bore out to the break at the turn of the breath, when its white water is spent.
    const uBore = uniform(0);
    const uLace = uniform(0.2);
    const uOut = uniform(0);
    const uIncoming = uniform(0);
    const sun = vec3(...SUN_DIR);

    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const portrait = u.ext.y.sub(1).div(1.16).saturate().toVar();
        const horizon = mix(float(HORIZON[0]), float(HORIZON[1]), portrait).toVar();
        // Cast the screen onto the ground. `near` is the hero's distance over this point's (1 at the
        // hero): it is also the parallax, so near sand slides past the far sea as the camera leans in.
        const near0 = horizon.sub(p.y).div(horizon).max(0.12);
        const q = layer(p, u, near0).toVar();
        const near = horizon.sub(q.y).div(horizon).max(0.12).toVar();
        const far = float(1).div(near).toVar();
        const g = vec2(q.x.mul(far), q.y.mul(far).div(SIN_PITCH)).toVar();
        // Ground units per pixel, along the view (the long axis of a pixel's footprint).
        const foot = u.px.mul(far).mul(far).div(SIN_PITCH).toVar();
        const view = normalize(vec3(q.x, q.y.sub(horizon).mul(COS_PITCH), horizon.mul(FOCAL).add(q.y.mul(SIN_PITCH))))
            .toVar();
        const toEye = view.negate().toVar();
        const mirror = vec3(view.x, toEye.y, view.z).toVar();
        const t = u.time.toVar();
        // The water's own clock runs a little faster while the wave runs in (breath-paced, no jumps).
        const tide = t.mul(0.75).add(u.breathInt.mul(0.5)).toVar();

        // The beach's own frame: c runs seaward from the mean waterline, `along` follows the shore.
        const tilt = mix(float(SHORE_TILT[0]), float(SHORE_TILT[1]), portrait).toVar();
        const cosT = tilt.cos().toVar();
        const sinT = tilt.sin().toVar();
        const rel = g.sub(vec2(0, mix(float(SHORE_AHEAD[0]), float(SHORE_AHEAD[1]), portrait))).toVar();
        const along = rel.x.mul(cosT).sub(rel.y.mul(sinT)).toVar();
        const c = rel.x.mul(sinT).add(rel.y.mul(cosT)).add(sq(along).mul(BAY)).toVar();
        const seaward = normalize(vec2(sinT, cosT).add(vec2(cosT, sinT.negate()).mul(along.mul(2 * BAY)))).toVar();

        // The swash front. A real swash arrives fast, slows at the top of its run and accelerates
        // back down; the breath's ease supplies most of that, this curve the rest.
        const b = u.breathSoft.toVar();
        const run = b.mul(float(1.5).sub(b.mul(0.5))).toVar();
        // Lobes and cusps: the front never runs up as a straight line, and each wave reaches a
        // little differently as the field drifts.
        const lobes = fbm(vec2(along.mul(0.9).add(1.7), t.mul(0.03)), 3).sub(0.5).mul(0.6)
            .add(along.mul(2.6).add(t.mul(0.07)).sin().mul(0.05))
            .toVar();
        const cusps = gnoise(vec2(along.mul(6), t.mul(0.12))).sub(0.5).mul(0.07).toVar();
        const reachFull = mix(float(REACH_FULL[0]), float(REACH_FULL[1]), portrait);
        const front = mix(float(REACH_EMPTY), reachFull, run).add(lobes.mul(run.mul(0.6).add(0.4))).add(cusps.mul(run))
            .toVar();
        // The highest the water climbs: the wet sand ends here.
        const reachLine = reachFull.add(lobes).toVar();
        const x = c.sub(front).toVar();
        const edge = foot.mul(1.2).add(0.0015);
        const water = smoothstep(edge.negate(), edge, x).toVar();

        // Depth. Offshore the bed shelves into a lagoon past a low sandbar; up the beach the swash is
        // a thin sheet thickening behind its front; when the backwash has drawn the sea down below
        // its rest line, the sea surface sags to meet the front and recovers seaward. Far out the
        // lagoon shoals onto a reef flat, and beyond the reef the ocean drops away.
        const shelf = (cc) => {
            const s = cc.max(0);
            return s.mul(0.4).add(sq(s).mul(0.32)).min(2.2);
        };
        const bar = exp(sq(c.sub(1.2)).mul(-6)).mul(0.12);
        const sheet = x.max(0).mul(0.22);
        const sea = shelf(c).sub(bar).sub(shelf(front).mul(exp(x.max(0).mul(-1.8)))).max(0);
        const reefAt = float(REEF).add(along.mul(0.6).add(1.3).sin().mul(0.25)).add(lobes.mul(0.7));
        const toReef = c.sub(reefAt).toVar();
        const reefFlat = exp(sq(toReef.add(0.06).div(0.2)).negate());
        const lagoon = mix(sheet.max(sea), float(0.32), reefFlat.mul(0.85));
        const depth = mix(lagoon, float(7), smoothstep(0.03, 0.4, toReef)).toVar();

        // Cloud shadows: soft, slow, much larger than anything on the sand.
        const cloud = fbm(g.mul(vec2(0.16, 0.22)).add(vec2(t.mul(0.012), t.mul(-0.005)).add(2.4)), 2);
        const sunVis = float(1).sub(smoothstep(0.42, 0.8, cloud).mul(0.24)).toVar();

        // The bore: the white water a wave carries. While the lungs fill it is the swash's own front,
        // churning up the sand; once the out-breath begins the next wave breaks offshore and rolls in
        // to meet the backwash, arriving just as the lungs empty. It rides a hump of water whose
        // shoreward face, steep and thin, the low sun shines through.
        const incoming = mix(float(REACH_EMPTY).add(0.02), float(BREAK_LINE), b.mul(b)).add(lobes.mul(0.3))
            .add(cusps.mul(0.5));
        const boreAt = mix(front, incoming, uIncoming).toVar();
        const xb = c.sub(boreAt).toVar();
        const crest = exp(sq(xb.div(0.075)).negate()).mul(uOut).mul(fadeOut(0.82, 1.0, b)).toVar();
        const hump = seaward.mul(xb.mul(-2 / (0.075 * 0.075)).mul(crest).mul(0.011));

        // The water's surface: two trains of swell rolling in toward the beach, crossing a little so
        // no band runs straight, and chop boiling on top, rougher in drifting gusts (cat's paws).
        const gust = fbm(g.mul(vec2(0.7, 1.1)).add(vec2(t.mul(0.03), 7.7)), 2).toVar();
        const swellA = c.mul(10).add(t.mul(1.1)).add(gnoise(vec2(along.mul(0.9), t.mul(0.05))).mul(3)).add(gust.mul(3));
        const swellB = dot(g, vec2(-0.45, 0.89)).mul(7).add(t.mul(0.8)).add(gust.mul(5));
        // Far off the swell only shows as a sheen: at grazing angles a steep band would flip the
        // Fresnel term from sky to sea and stripe the distance.
        const swell = seaward.mul(swellA.cos().mul(0.018)).add(vec2(-0.45, 0.89).mul(swellB.cos().mul(0.012)))
            .mul(smoothstep(0.05, 0.6, depth))
            .mul(fadeOut(1.15, 2.0, far).mul(0.9).add(0.1))
            .mul(gust.mul(1.2).add(0.4));
        const chopAt = vec3(g.mul(vec2(26, 34)), tide.mul(0.5)).toVar();
        const chop = vec2(gnoise3(chopAt), gnoise3(chopAt.add(vec3(5.2, 1.3, 2.7)))).sub(0.5)
            .mul(resolve(foot, 0.03))
            .mul(smoothstep(0.3, 0.7, gust).mul(0.8).add(0.5))
            .mul(smoothstep(0.08, 0.6, depth).mul(0.45).add(0.55))
            .toVar();
        const surfSlope = swell.add(chop).add(hump).toVar();
        const normal = normalize(vec3(surfSlope.x.negate(), 1, surfSlope.y.negate())).toVar();

        // Sand: one warped field draws faint wind ripples on the dry beach and wave ripples under
        // water. The bed is seen through the surface, displaced along its slope (refraction).
        const bent = g.add(surfSlope.mul(depth.mul(0.1))).toVar();
        const warp = fbm(bent.mul(4.5).add(5.3), 3).toVar();
        const tone = fbm(bent.mul(vec2(1.4, 2.2)).add(11), Math.max(3, octaves - 1)).toVar();
        const windDir = vec2(0.83, 0.56);
        const wind = dot(bent, windDir).mul(TAU / 0.022).add(warp.mul(12)).toVar();
        const waves = c.mul(TAU / 0.028).add(warp.mul(7)).add(along.mul(5).sin().mul(1.2)).toVar();
        // Saturated sand runs from the highest reach down to the sea.
        const saturated = smoothstep(-0.02, 0.12, c.sub(reachLine).add(tone.sub(0.5).mul(0.1))).toVar();
        // Wind ripples lie in fields: crisp where the wind has worked the sand, faint between.
        const rippleField = smoothstep(0.5, 0.72, warp.mul(0.7).add(tone.mul(0.45)).sub(0.08));
        const windSlope = windDir.mul(wind.cos().add(wind.mul(2).add(0.6).cos().mul(0.4)))
            .mul(resolve(foot, 0.022).mul(rippleField.mul(0.1).add(0.008)));
        const waveSlope = seaward.mul(waves.cos())
            .mul(resolve(foot, 0.028).mul(smoothstep(0.45, 0.75, warp).mul(0.05).add(0.008)));
        // The beach's own form under the raking sun: the beach face tilts toward the sea (and the
        // sun) below a berm crest; above it the backshore rolls in low hummocks.
        const berm = smoothstep(-0.62, -0.38, c.sub(reachLine)).mul(0.07);
        const rollA = dot(g, vec2(0.55, 0.83)).mul(3.1).add(warp.mul(5)).cos();
        const rollB = dot(g, vec2(-0.8, 0.6)).mul(4.3).add(tone.mul(6)).cos();
        const roll = vec2(0.55, 0.83).mul(rollA.mul(0.035)).add(vec2(-0.8, 0.6).mul(rollB.mul(0.025)));
        const form = seaward.mul(berm.negate()).add(roll.mul(float(1).sub(saturated)));
        const slope = mix(windSlope, waveSlope, saturated).add(form).toVar();
        const sandNormal = normalize(vec3(slope.x.negate(), 1, slope.y.negate())).toVar();
        const lambert = dot(sandNormal, sun).max(0);
        const light = SUNLIGHT.mul(lambert.mul(SUN_POWER).mul(sunVis)).add(SKYLIGHT.mul(sandNormal.y.mul(0.3).add(0.3)))
            .toVar();
        const speck = hash21(bent.mul(300).floor()).sub(0.5).mul(resolve(foot, 0.007)).mul(0.18);
        const dryAlbedo = SAND.mul(tone.mul(0.26).add(0.84)).mul(speck.add(1)).toVar();
        // Damp sand darkens and cools; the nearer the water, the wetter. Old swash marks (fine
        // lines where earlier waves stopped) stripe the wet band.
        const wetness = saturated.mul(smoothstep(-0.5, 0.0, x).mul(0.15).add(0.8)).toVar();
        const marks = fadeOut(0.0, 0.012, c.sub(reachLine).sub(0.09).abs()).mul(0.5)
            .add(fadeOut(0.0, 0.01, c.sub(reachLine).sub(0.22).add(lobes.mul(0.2)).abs()).mul(0.35))
            .mul(resolve(foot, 0.02))
            .toVar();
        // Above the reach the sand is only damp from earlier, higher waves: a soft step toward dry.
        const damp = smoothstep(-0.35, 0.0, c.sub(reachLine).add(tone.sub(0.5).mul(0.2))).mul(0.18);
        const albedo = mix(dryAlbedo.mul(float(1).sub(damp)), dryAlbedo.mul(vec3(0.36, 0.35, 0.36)), wetness)
            .mul(marks.mul(0.25).add(1));
        const sand = albedo.mul(light).toVar();
        // A few bleached shells and coral bits lie scattered on the dry sand.
        const bitCell = g.mul(45).floor().toVar();
        const bitAt = g.mul(45).fract().sub(hash22(bitCell).mul(0.6).add(0.2));
        const shell = fadeOut(0.12, 0.22, bitAt.mul(vec2(1, 1.6)).length()).mul(step(0.993, hash21(bitCell.add(17.1))))
            .mul(resolve(foot, 0.04))
            .mul(float(1).sub(saturated));
        sand.addAssign(light.mul(vec3(0.3, 0.27, 0.24)).mul(shell));
        // Quartz grains facing the low sun: tiny sparks on the dry sand that swell and fade slowly.
        const grain = bent.mul(240).floor().toVar();
        const sparkPick = hash21(grain.add(41.7)).toVar();
        const spark = step(0.994, sparkPick).mul(sq(sq(t.mul(sparkPick.mul(0.9).add(0.6)).add(sparkPick.mul(90)).sin()
            .mul(0.5)
            .add(0.5))))
            .mul(resolve(foot, 0.008))
            .mul(float(1).sub(saturated))
            .mul(sunVis);
        sand.addAssign(SUNLIGHT.mul(spark).mul(2.2));
        // A film of water still draining off the sand mirrors the warm sky and the low sun; it is
        // longest behind the retreating backwash and dries back toward the waterline.
        const behind = front.sub(c).max(0);
        const film = exp(behind.mul(mix(float(8), float(4.5), uOut)).negate()).mul(saturated).toVar();
        const sheen = fresnel(toEye.y, 0.02).mul(2).add(0.065).add(film.mul(0.45))
            .mul(saturated);
        sand.assign(mix(sand, skyRadiance(mirror, sun), sheen));
        const toward = dot(mirror, sun).max(0).toVar();
        sand.addAssign(SUNLIGHT.mul(sq(sq(toward)).mul(film.mul(1.1).add(saturated.mul(0.12))).mul(sunVis)));

        // The bed under the water: white sand in the shallows, darker weed and rock farther out.
        const weed = smoothstep(0.6, 0.72, tone).mul(smoothstep(1.3, 2.4, c)).mul(0.6);
        const bedAlbedo = mix(BED.mul(tone.mul(0.22).add(0.86)), WEED, weed);
        const bedRipples = waves.cos().mul(resolve(foot, 0.028)).mul(smoothstep(0.4, 0.7, warp).mul(0.08).add(0.02))
            .add(1);
        // Caustics: two drifting nets, brightest in water a hand deep, fading with depth.
        const causticPoint = bent.mul(13).add(vec2(tide.mul(0.18), tide.mul(-0.12))).toVar();
        // High tiers cross two cellular nets; lighter ones wind noise threads (no straight walls).
        const crossing = () => causticNet(causticPoint.mul(0.71).add(vec2(3.1, 7.7)), tide.add(9), 0.6)
            .mul(1.3)
            .add(0.35);
        const net = (fine ? causticNet(causticPoint, tide, 0.8).mul(crossing()) : causticThreads(causticPoint, tide))
            .toVar();
        // Where the surface runs smooth the light is barely focused: the nets come and go in patches.
        const focus = smoothstep(0.25, 0.65, gust).mul(0.7).add(0.3);
        const causticGain = smoothstep(0.02, 0.15, depth).mul(exp(depth.mul(-1.1))).mul(resolve(foot, 0.07)).mul(sunVis)
            .mul(focus);
        const bedLit = bedAlbedo.mul(bedRipples)
            .mul(SUNLIGHT.mul(sunVis.mul(0.5).add(net.mul(causticGain).mul(0.9))).add(SKYLIGHT.mul(0.5)))
            .toVar();

        // The water column: red goes first, then green; what is not absorbed scatters back blue.
        const trans = exp(ABSORB.mul(depth).negate()).toVar();
        const under = bedLit.mul(trans).mul(trans).add(DEEP.mul(float(1).sub(exp(depth.mul(-2.4))))).toVar();
        const facing = clamp(dot(toEye, normal), 0, 1);
        // Far off, where the chop is finer than a pixel, rough patches (cat's paws) scatter the sky
        // and read darker than the glassy water between them.
        const glassy = float(1).sub(resolve(foot, 0.03)).mul(smoothstep(0.35, 0.7, gust)).mul(0.35);
        const reflectance = fresnel(facing, 0.02).mul(0.68).mul(float(1).sub(glassy)).toVar();
        const seaColor = mix(under, skyRadiance(reflect(view, normal), sun), reflectance).toVar();
        // Sun glitter: chop facets that tip the low sun into the lens, along the path toward the sun.
        const path = exp(float(1).sub(toward).mul(-26)).toVar();
        const glitterNormal = normalize(vec3(chop.x.mul(-2.2), 1, chop.y.mul(-2.2)));
        const half = normalize(sun.add(toEye));
        const glint = pow(clamp(dot(glitterNormal, half), 1e-4, 1), 700).mul(GLINT).mul(path).mul(sunVis)
            .mul(resolve(foot, 0.02));
        // Where the chop is finer than a pixel its glints merge into the sun's glitter path: a
        // glowing column toward the low sun, broken into bands by the swell.
        const tiltToSun = float(1).sub(half.y).toVar();
        // Each swell crest catches a thin streak of light, broken along its length.
        const crestLight = sq(sq(swellA.mul(2.3).add(gust.mul(9)).sin()
            .mul(0.5)
            .add(0.5)));
        const broken = smoothstep(0.4, 0.75, gnoise(g.mul(vec2(13, 11)).add(t.mul(0.15))));
        const sunPath = exp(tiltToSun.mul(-90)).mul(float(1).sub(resolve(foot, 0.03)))
            .mul(crestLight.mul(broken).add(0.16))
            .mul(sunVis);
        seaColor.addAssign(SUNLIGHT.mul(glint.add(path.mul(path).mul(0.16)).add(sunPath)));
        // The incoming wave's face, lit from behind: a band of glowing green-turquoise below its crest.
        const face = smoothstep(-0.16, -0.03, xb).mul(fadeOut(-0.03, 0.01, xb))
            .mul(crest.max(uOut.mul(0.6)))
            .mul(uOut)
            .mul(fadeOut(0.85, 1.0, b))
            .mul(sunVis);
        seaColor.addAssign(vec3(0.05, 0.42, 0.34).mul(face).mul(0.55));

        // Foam rides with the water: up the sand on the uprush, back down on the backwash.
        const flowing = vec2(along, c.sub(front.mul(0.85)).mul(0.8)).toVar();
        const swirl = vec2(gnoise(flowing.mul(2.5)), gnoise(flowing.mul(2.5).add(5.2))).sub(0.5).mul(0.3);
        const drifted = flowing.add(swirl).toVar();
        // Foam is densest in a narrow band at the bore; behind the running front fresh churn pulls out
        // into streamers along the flow, with clear water between. A ribbon of lace always rims the
        // water's edge; older lace from the uprush rides the water to the top of the run and drains
        // back with the backwash; older rafts drift in the shallows.
        const streams = fbm(drifted.mul(vec2(9, 3.2)).add(3.3), 3).toVar();
        const streamer = smoothstep(0.46, 0.7, streams).toVar();
        const gate = smoothstep(-0.03, 0.01, xb);
        const wet = x.max(0).toVar();
        const rafts = smoothstep(0.66, 0.84, gnoise(drifted.mul(2.6).add(vec2(9.1, t.mul(0.01)))))
            .mul(exp(wet.mul(-0.9)))
            .mul(0.45);
        // Out at the break the wave breaks unevenly: its peaks whiten first, the shoulders follow.
        const peaks = mix(float(1), smoothstep(-0.18, 0.12, lobes.negate().add(cusps.mul(3))).mul(0.8).add(0.2), uOut);
        const white = uBore.mul(peaks).toVar();
        const churn = exp(xb.max(0).mul(-2.2)).mul(gate).mul(streamer).mul(white.mul(0.75))
            .mul(float(1).sub(uOut));
        const density = exp(xb.max(0).mul(-10)).mul(gate).mul(white.mul(0.8))
            .add(churn)
            .add(exp(wet.mul(-12)).mul(smoothstep(0.3, 0.6, streams).mul(0.3).add(0.25)))
            .add(exp(wet.mul(-2.4)).mul(streamer).mul(uLace))
            .max(rafts)
            .saturate()
            .toVar();
        // Lace is stretched along the flow. Dense foam is solid white with pin-holes; as it thins
        // the holes open into a web of threads, and the threads finally tear.
        const thin = float(1).sub(density).toVar();
        const coarse = foamWeb(drifted.mul(vec2(19, 12)), t.mul(0.3), sq(thin).mul(0.42).add(0.08));
        let lace = coarse.web.mul(smoothstep(0.04, 0.2, density));
        const pinholes = () => foamWeb(drifted.mul(vec2(60, 42)).add(7.7), t.mul(0.4), thin.mul(0.34).add(0.04)).web;
        if (fine) lace = lace.mul(pinholes());
        // The bore itself: solid white water, its back torn into fingers that stream seaward.
        const boreWidth = uBore.mul(0.14).add(0.025).mul(lobes.mul(1.6).add(1)).max(0.01)
            .toVar();
        const fingers = fbm(vec2(along.mul(30), xb.mul(5).sub(t.mul(0.25))), 2);
        const bore = fadeOut(boreWidth.mul(0.4), boreWidth.mul(1.4), xb.add(fingers.sub(0.5).mul(boreWidth.mul(1.6))))
            .mul(smoothstep(-0.02, 0.0, xb))
            .mul(white);
        // The very edge of the water is always a thin bright fringe of bubbles.
        const fringe = exp(sq(x.div(0.008)).negate()).mul(0.8);
        // Surf on the reef: a ragged white line where the swell breaks, spilling into the lagoon in
        // streaks, swelling and easing as sets come through.
        const reefNoise = gnoise(vec2(along.mul(7), toReef.mul(5).add(t.mul(0.3)))).toVar();
        const sets = smoothstep(0.0, 0.8, along.mul(1.7).add(t.mul(0.3)).sin()
            .add(reefNoise.sub(0.5).mul(1.6)));
        const surfLine = fadeOut(0.02, 0.09, toReef.add(0.03).abs().add(reefNoise.sub(0.5).mul(0.09)));
        const spill = exp(toReef.min(0).mul(6)).mul(fadeOut(-0.01, 0.02, toReef)).mul(smoothstep(0.5, 0.72, reefNoise));
        const reefSurf = surfLine.add(spill.mul(0.55)).mul(sets);
        // Bubbles: fine bright specks in the foam, and stranded on the sand as the backwash leaves.
        const bubbleCell = drifted.mul(vec2(150, 95)).floor().toVar();
        const bubbleAt = drifted.mul(vec2(150, 95)).fract().sub(hash22(bubbleCell).mul(0.5).add(0.25));
        const stranded = exp(behind.mul(-14)).mul(uOut).mul(saturated);
        const bubbles = fadeOut(0.1, 0.24, bubbleAt.length())
            .mul(step(float(1).sub(density.mul(0.5).add(stranded.mul(0.35))), hash21(bubbleCell.add(3.7))))
            .mul(resolve(foot, 0.012))
            .mul(0.85);
        const foam = bore.max(lace.mul(resolve(foot, 0.025))).max(fringe).max(reefSurf)
            .mul(water)
            .max(bubbles.mul(water.max(stranded)))
            .saturate()
            .toVar();
        // Churned foam is lumpy: sunlit tops, blue-grey hollows.
        const lumps = fingers.mul(bore).add(float(1).sub(bore).mul(0.55));
        const foamLight = mix(SUNLIGHT, vec3(1), 0.45).mul(sunVis.mul(0.8)).add(SKYLIGHT.mul(0.6))
            .mul(density.mul(0.25).add(0.8))
            .mul(lumps.mul(0.5).add(0.72))
            .add(SUNLIGHT.mul(bore.mul(sq(fingers)).mul(0.5)));

        // The running bore stands a hand high against the low sun ahead: it throws a short soft
        // shadow onto the wet sand it is about to cover.
        const boreShadow = exp(sq(x.add(0.028).div(0.022)).negate()).mul(fadeOut(-0.004, 0.0, x))
            .mul(white.mul(float(1).sub(uOut)))
            .mul(sunVis);
        sand.mulAssign(float(1).sub(boreShadow.mul(0.4)));
        const col = mix(sand, seaColor, water).toVar();
        col.assign(mix(col, FOAM.mul(foamLight), foam));
        // The far sea melts into the warm haze of the low sun.
        // Toward the sun the haze is lit gold.
        const haze = float(1).sub(exp(far.sub(1).max(0).mul(-0.3)));
        const sunward = sq(sq(dot(vec2(view.x, view.z), vec2(SUN_DIR[0], SUN_DIR[2])).max(0)));
        col.assign(mix(col, HAZE.mul(sunward.mul(0.7).add(0.75)), haze.mul(0.2)));
        // The low sun just beyond the frame lays a warm veil over its side of the view.
        const glare = smoothstep(0.5, 0.9, dot(view, sun));
        col.addAssign(SUNLIGHT.mul(sq(glare)).mul(0.2));
        return col.mul(b.mul(0.08).add(0.96));
    })();

    return {
        backdrop,
        bloom: {
            strength: 0.3, radius: 0.55, threshold: 0.95, breath: 0.35,
        },
        grade: {
            shadows: [0.86, 0.99, 1.06], highlights: [1.06, 1.0, 0.9], saturation: 1.08, contrast: 1.1, vignette: 0.38,
        },
        camera: { dolly: 0.03, drift: [0.03, 0.015], period: 70 },
        exposure: 0.96,
        update({ delta, phase, progress }) {
            const at = Math.min(1, Math.max(0, progress));
            const ramp = (lo, hi, v) => {
                const s = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
                return s * s * (3 - 2 * s);
            };
            // White water, continuous at every turn: it builds as the next wave breaks during the
            // out-breath, rides the front up the sand and is spent before the top (so the bore can
            // move out to the break unseen). Lace gathers through the uprush and thins as it drains.
            const bore = [1 - ramp(0.25, 0.9, at), 0, ramp(0.15, 0.55, at), 1 - ramp(0, 1, at) * 0.6][phase] ?? 0;
            const lace = [0.2 + ramp(0, 0.6, at) * 0.4, 0.6, 0.6 - ramp(0.2, 1, at) * 0.4, 0.2][phase] ?? 0.2;
            const out = phase >= 2 ? 1 : 0;
            const follow = delta > 0 ? 1 - Math.exp(-delta * 3) : 1;
            uBore.value += (bore - uBore.value) * follow;
            uLace.value += (lace - uLace.value) * follow;
            uOut.value += (out - uOut.value) * follow;
            uIncoming.value = out;
        },
    };
}

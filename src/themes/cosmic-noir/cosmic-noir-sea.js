/**
 * Cosmic Noir — the dark sea.
 *
 * A surface: slow swells with billows heaped on them, combed by the wind and flowing past the
 * rock, and long rollers running in on top. It is found along each view ray at the screen's own
 * resolution (steps as long as the ray's clearance over the sea allows, then a secant to the
 * crossing, read over the long reach of sea a pixel spans where it looks along the water), so its
 * crests are sharp against the dark and its far reaches settle into a level sea under the
 * horizon's mist.
 *
 * Three things lie in one place, and each is lit its own way (cnSeaLight):
 *   - the water is black glass and shows only what it mirrors, more at a glance than head-on: the
 *     night sky's own glow (which is what models the waves), the galaxy as a road toward the eye,
 *     the far light as a thread, the lamp as glints, an echo's ring, a lock's two rings of light;
 *   - the smoke that lies on it in drifts is matte: the lamp's light through the slats and the
 *     beam that looks down (every swell throws a shadow away from the rock, found by a few reads
 *     of the sea toward the lamp), crests that glow through, the galaxy on slopes that face it;
 *   - white water, on a roller's crest and in the wash round the rock, whole while it is fresh and
 *     torn into lace (a baked field of cell walls) as it ages.
 * A fringe of loose smoke is summed along the walk, so a ray that only grazes a crest takes some
 * of its light; the weather says how much of it there is.
 */

import {
    Break,
    If,
    Loop,
    clamp,
    dot,
    exp,
    float,
    int,
    length,
    log2,
    max,
    min,
    mix,
    normalize,
    pow,
    reflect,
    smoothstep,
    sqrt,
    vec2,
    vec3,
} from 'three/tsl';
import {
    PULSAR, ROCK, ROCK_XZ, ROLLER_MEAN, SEA, SEA_WIND, cnBeam, cnCage, cnLampAt, cnPhase, cnSeaHeight,
    cnSeaStreaks, cnSeaSurface,
} from './cosmic-noir-tsl.js';
import { FAR_LAMP_DIR, GALAXY_DIR } from './cosmic-noir-sky.js';
import { cnRockDist } from './cosmic-noir-lighthouse.js';

/**
 * A pixel that looks along the sea spans a reach of it 1 / (how steeply it looks down) times as
 * long as it is wide. The sea is read over that reach to this power: a mirror shows every facet,
 * and one thinner than a pixel is a dashed line that crawls.
 */
const GRAZE = 0.75;
/** The steepest the sea is taken to be (a longer step may overshoot a crest: the secant recovers it). */
const MAX_SLOPE = 0.55;
/** A step is this share of what the clearance allows. */
const RELAX = 0.92;
/** How far round a slope the lamp's light still wraps (smoke has no hard terminator). */
const WRAP = 0.6;
/** The light left in a swell's shadow (the smoke round it scatters some in). */
const SHADOW_FILL = 0.2;
/** An echo's ring on the sea: its light, and how wide it is drawn. */
const ECHO_LIGHT = 1.5;
/** A lock's ember under the smoke, and the ripples it sends out. */
const EMBER_LIGHT = 0.22;
const EMBER_THROUGH = 0.5;
const RIPPLE_SPEED = 3.4;
const RIPPLE_WIDTH = 0.42;
const RIPPLE_HEIGHT = 0.16;
const RIPPLE_LINE = 0.17;
const RIPPLE_LIGHT = 1.5;
/** The galaxy's light on the smoke that lies on the sea, on slopes that face it. */
const GALAXY_LIGHT = 0.036;
/** The water mirrors head-on this share of what it mirrors at a glance. */
const WATER_F0 = 0.03;
/**
 * What no pixel resolves breaks the mirror (the variance of its slope): a little at the eye, more
 * with the reach of sea a pixel spans.
 */
const ROUGH_NEAR = 0.02;
const ROUGH_FOOT = 0.5;
const ROUGH_FAR = 0.2;
/** The galaxy's road on the water, the far light's thread, and the lamp's glints. */
const GALAXY_ROAD = 1.5;
const FAR_ROAD = 2.4;
const LAMP_GLINT = 3.2;
/** The smoke that lies on the water: how matte the sea is where it lies thick, and where it lies thin. */
const SKIN = 0.2;
const SKIN_LEAST = 0.04;
/** White water: one tile of its lace (scene units), how fast it drifts, how far out it is drawn, how white it is. */
const FOAM_TILE = 4.2;
const FOAM_DRIFT = 0.16;
const FOAM_REACH = 95;
const FOAM_WHITE = 2.6;
/** The horizon's mist takes the sea over this distance. */
const MIST_REACH = 105;
/** The fringe of loose smoke on the sea: its depth (on a calm sea, and more where it is heaped), how thick, how lit. */
const FRINGE = 0.12;
const FRINGE_HEAP = 0.42;
const FRINGE_SMOKE = 1.5;
const FRINGE_LIGHT = 0.55;
/** How many times deeper the fringe stands round the rock where a full wave has just broken. */
const FRINGE_CHURN = 3.5;
/** And on a roller's crest (its spindrift). */
const FRINGE_CREST = 3.6;
/** What the lamp lets fall through the gallery onto the white water at the rock's foot (a share of its own light). */
const CREST_FALL = 0.2;
/** The loose smoke's share of what the lamp lets fall straight down, and of the galaxy's light. */
const FRINGE_FALL = 0.26;
const FRINGE_GALAXY = 0.035;

/** The sea's swells sink into a level sea toward SEA.flat (1 near, 0 far). */
const sinkAt = (t) => float(1.0).sub(smoothstep(SEA.flat * 0.3, SEA.flat, t));

/** The sea's highest reach (its heave raises it). */
export const cnSeaTop = (u) => float(SEA.swell + SEA.billow + SEA.wisp).mul(u.seaHeave)
    .add(u.seaRoll.z.mul(1 - ROLLER_MEAN))
    .add(SEA.level);

/**
 * Where a view ray meets the sea. Call inside a Fn.
 *
 * The sea has no hard skin: a thin fringe of loose smoke lies on it, thicker where it is heaped.
 * The walk sums how much of that fringe the ray passed through on its way (its steps are short
 * exactly where it skims a crest), and where: a ray that only grazes a crest still takes some of
 * its light, so crests are soft against what lies behind them.
 * @returns {{ t: object, fringe: object, at: object }} vars: the distance along the ray to the sea
 *   (−1 where it never comes down to it), the fringe's depth along the way, and the distance at
 *   which it lay
 */
export function cnSeaMarch(u, o, ray, { march = 52 } = {}) {
    const hitT = float(-1.0).toVar();
    const fringe = float(0.0).toVar();
    const fringeAt = float(0.0).toVar();
    const top = cnSeaTop(u).toVar();
    // (The eye may stand below the sea's highest reach under a surge: the walk then starts at the
    // eye. It never stands below the sea itself.)
    If(ray.y.lessThan(-0.0015), () => {
        const fall = ray.y.negate().toVar();
        const run = sqrt(max(float(1.0).sub(ray.y.mul(ray.y)), 1e-6)).toVar();
        const tLevel = o.y.sub(SEA.level).div(fall).toVar();
        const t = max(o.y.sub(top).div(fall), 0.0).toVar();
        const tPrev = t.toVar();
        const cPrev = float(1.0).toVar();
        const cNow = float(1.0).toVar();
        const found = float(0.0).toVar();
        // A pixel at a grazing angle spans a long reach of sea, and the walk reads the sea that
        // softly: a ridge thinner than a pixel is no silhouette, only a row of dots along it.
        const stretch = float(1.0).div(pow(clamp(fall, 0.03, 1.0), GRAZE)).toVar();
        Loop(march, () => {
            const sink = sinkAt(t).toVar();
            const p = o.add(ray.mul(t)).toVar();
            const sea = cnSeaHeight(u, p.xz, t.mul(u.pixelAngle).mul(stretch), sink).toVar();
            const c = p.y.sub(sea.x.add(SEA.level)).toVar();
            cNow.assign(c);
            If(c.lessThan(t.mul(0.0012)), () => {
                found.assign(1.0);
                Break();
            });
            tPrev.assign(t);
            cPrev.assign(c);
            const steep = sink.mul(u.seaHeave).mul(MAX_SLOPE);
            const stride = max(c.div(fall.add(run.mul(steep))).mul(RELAX), t.mul(0.003)).toVar();
            // The fringe this step crosses (none far out, where the sea is level and under mist).
            // Where a wave has just broken the sea round the rock is churned: its fringe stands deep.
            const offShore = length(p.xz.sub(vec2(ROCK_XZ[0], ROCK_XZ[1]))).sub(ROCK.shore).div(3.2);
            // And a roller's crest streams its own: spindrift, which is what shows it coming in.
            const churned = u.seaRoll.w.mul(exp(offShore.mul(offShore).negate())).mul(FRINGE_CHURN)
                .add(sea.z.mul(FRINGE_CREST))
                .add(1.0);
            const deep = sea.y.mul(FRINGE_HEAP).add(FRINGE).mul(churned).mul(sink);
            const inFringe = clamp(float(1.0).sub(c.div(max(deep, 1e-3))), 0.0, 1.0);
            const took = inFringe.mul(inFringe).mul(stride).mul(u.fringe.mul(FRINGE_SMOKE)).toVar();
            fringe.addAssign(took);
            fringeAt.addAssign(took.mul(t));
            t.addAssign(stride);
            If(t.greaterThan(SEA.far), () => {
                Break();
            });
        });
        If(found.greaterThan(0.5), () => {
            // Between the last step above the sea and this one. (A ray that came within the
            // threshold while still above a crest has met it here: the two clearances drawn on as
            // a line would put it anywhere beyond, a different place from one pixel to the next.)
            hitT.assign(tPrev.add(t.sub(tPrev).mul(clamp(cPrev.div(max(cPrev.sub(cNow), 1e-5)), 0.0, 1.0))));
        }).Else(() => {
            // Out of steps over a far sea: it is level there.
            hitT.assign(max(t, tLevel));
        });
        fringeAt.assign(fringeAt.div(max(fringe, 1e-5)));
    });
    return { t: hitT, fringe, at: fringeAt };
}

/**
 * The light of the fringe a ray passed through: vec2(its light, how much of what lies behind it
 * hides). Loose smoke, lit by the lamp from wherever it stands (it throws no shadow on itself).
 */
export function cnSeaFringe(u, o, ray, walk) {
    const p = o.add(ray.mul(walk.at)).toVar();
    const hide = float(1.0).sub(exp(walk.fringe.negate()));
    const from = normalize(p.sub(u.pulsar));
    const lamp = cnLampAt(u, p, float(0.14)).mul(cnPhase(dot(from, ray.negate()), u.forward).mul(0.55).add(0.45));
    // Round the rock it also takes what the lamp lets fall through the gallery, and the galaxy's
    // light: the churned sea a breaking wave leaves, and the spindrift of the next one coming in.
    const under = length(p.sub(u.pulsar)).div(PULSAR.coreReach * 1.5);
    const fall = u.coreGain.mul(FRINGE_FALL).div(under.mul(under).add(1.0)).add(u.galaxy.mul(FRINGE_GALAXY));
    return vec2(lamp.mul(FRINGE_LIGHT).add(fall).add(u.ambient.mul(0.8)).mul(u.breath), hide);
}

/**
 * The sea's light where a view ray met it at distance `t`. Call inside a Fn.
 *
 * Three things lie in one place and each is lit its own way:
 *   - the water: black glass. It shows only what it mirrors, more at a glance than head-on: the
 *     night sky's own glow (so a wave's far face is silver and its near face black), the galaxy
 *     as a long road toward the eye, the far light as a thread, the lamp as glints on whatever
 *     facet is tipped to it;
 *   - the smoke lying on it in drifts: matte, lit softly from wherever the lamp stands (the beam's
 *     pool, the slats' spokes, an echo's ring, a lock's ember);
 *   - white water: where a roller's crest tips over and where the sea washes round the rock, whole
 *     while it is fresh and torn into lace as it ages.
 * @param {object} far  what the horizon's mist shows on this bearing (the sky's own light there)
 * @returns {object} a var: its light
 */
export function cnSeaLight(u, o, ray, t, far, { shadow = 8, fine = true, foam = true } = {}) {
    const sink = sinkAt(t).toVar();
    const flat = o.add(ray.mul(t)).toVar();
    // A pixel at a grazing angle spans a long reach of sea: read it that softly.
    const foot = t.mul(u.pixelAngle).div(pow(clamp(ray.y.negate(), 0.03, 1.0), GRAZE)).toVar();
    const s = cnSeaSurface(u, flat.xz, foot, sink, { fine }).toVar();
    const p = vec3(flat.x, s.x.add(SEA.level), flat.z).toVar();
    const slope = vec2(s.y, s.z).toVar();
    const reach = float(SEA.swell + SEA.billow).mul(u.seaHeave);
    // How high on its swell this point rides (0 in a trough, 1 on a crest).
    const crest = smoothstep(-0.75, 0.75, s.x.div(reach)).toVar();

    // ── Locks: an ember under the sea, and rings of ripples running out from it ──
    const ember = float(0.0).toVar();
    const rings = float(0.0).toVar();
    Loop({
        start: int(0), end: u.puffCount, type: 'int', condition: '<', name: 'k',
    }, ({ k }) => {
        const a = u.puffs.element(k.mul(2));
        const b = u.puffs.element(k.mul(2).add(1));
        const dv = p.xz.sub(a.xz).toVar();
        const away = max(length(dv), 1e-3).toVar();
        If(away.lessThan(22.0), () => {
            const glow = away.div(a.w.mul(1.5).add(0.6));
            ember.addAssign(b.y.mul(exp(glow.mul(glow).negate())).mul(EMBER_LIGHT));
            // Two rings run out over the water, the second inside the first, each a line of light
            // (a ring's lip tips the sky into the eye) that thins as it spreads.
            const ring = b.w.mul(RIPPLE_SPEED).toVar();
            const x = away.sub(ring).div(RIPPLE_WIDTH).toVar();
            // (Drawn finer than the swell they are: a line, not a band.)
            const outer = x.mul(RIPPLE_WIDTH / RIPPLE_LINE);
            const inner = away.sub(ring.mul(0.56)).div(RIPPLE_LINE * 0.8);
            const fading = b.x.mul(exp(b.w.mul(-0.4))).div(ring.mul(0.07).add(1.0));
            rings.addAssign(exp(outer.mul(outer).negate()).add(exp(inner.mul(inner).negate()).mul(0.6)).mul(fading));
            if (fine) {
                const lift = b.x.mul(RIPPLE_HEIGHT).mul(exp(b.w.mul(-0.55))).div(ring.mul(0.22).add(1.0));
                // The slope of a ring-shaped rise: outward it falls, inward it climbs.
                const tilt = x.mul(exp(x.mul(x).negate())).mul(-2.0 / RIPPLE_WIDTH).mul(lift);
                slope.addAssign(dv.div(away).mul(tilt));
            }
        });
    });
    const n = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())).toVar();

    // ── The lamp ──
    const toLamp = u.pulsar.sub(p).toVar();
    const r = length(toLamp).toVar();
    const l = toLamp.div(r).toVar();
    const d = l.negate().toVar();
    const gate = cnCage(d, u.spin, u.spinE1, u.spinE2, u.cageTurn, u.cageFill, r.mul(0.006).add(0.1));
    const rb = r.div(PULSAR.beamReach);
    const rc = r.div(PULSAR.coreReach);
    const lamp = gate.mul(
        u.coreGain.div(rc.mul(rc).add(1.0))
            .add(cnBeam(d, u.beam).mul(u.beamGain).div(rb.mul(rb).add(1.0))),
    ).toVar();
    const facing = dot(n, l).toVar();
    const wrap = clamp(facing.add(WRAP).div(1 + WRAP), 0.0, 1.0).toVar();
    const lit = float(1.0).toVar();
    if (shadow > 0) {
        // A swell's shadow: walk toward the lamp while the path is still down among the swells.
        If(lamp.mul(wrap).greaterThan(0.0015), () => {
            const span = min(cnSeaTop(u).sub(p.y).div(max(l.y, 0.03)), r.mul(0.85)).toVar();
            Loop(shadow, ({ i }) => {
                const k = float(i).add(1.0).div(shadow);
                const away = span.mul(k.mul(k)).toVar();
                const q = p.add(l.mul(away)).toVar();
                const h = cnSeaHeight(u, q.xz, max(foot, away.mul(0.04)), sink).x.add(SEA.level);
                const pen = away.mul(0.12).add(0.05);
                lit.assign(min(lit, smoothstep(pen.negate(), pen, q.y.sub(h).add(pen.mul(0.8)))));
            });
        });
    }
    const shaded = lamp.mul(mix(SHADOW_FILL, 1.0, lit)).toVar();
    const direct = shaded.mul(wrap).toVar();
    // What the lamp lets fall through the gallery lights the white water at the rock's foot.
    const under = r.div(PULSAR.coreReach * 1.5);
    const fall = u.coreGain.mul(CREST_FALL).div(under.mul(under).add(1.0)).toVar();

    // ── A light echo: a ring running out from the rock ──
    const echo = float(0.0).toVar();
    const out = length(p.xz.sub(u.pulsar.xz)).toVar();
    Loop({
        start: int(0), end: u.echoCount, type: 'int', condition: '<', name: 'e',
    }, ({ e }) => {
        const a = u.echoes.element(e);
        const x = out.sub(a.w).div(a.w.mul(0.03).add(a.y.mul(0.9)));
        echo.addAssign(a.z.mul(exp(x.mul(x).negate())));
    });
    const ring = echo.mul(ECHO_LIGHT).div(out.div(60.0).pow(2.0).add(1.0)).toVar();

    // ── The water: what it mirrors ──
    const toEye = ray.negate();
    const glance = float(1.0).sub(clamp(dot(n, toEye), 0.0, 1.0)).toVar();
    const g2 = glance.mul(glance);
    const fresnel = g2.mul(g2).mul(glance).mul(1 - WATER_F0).add(WATER_F0)
        .toVar();
    const back = reflect(ray, n).toVar();
    // What no pixel resolves breaks the mirror: a light's image is drawn out toward the eye.
    const rough = clamp(foot.mul(ROUGH_FOOT), 0.0, ROUGH_FAR).add(ROUGH_NEAR).mul(u.seaRough).toVar();
    const road = (dir, across, along) => {
        const off = back.sub(vec3(dir[0], dir[1], dir[2]));
        const az = off.x.mul(off.x).add(off.z.mul(off.z));
        return exp(az.div(across * across).add(off.y.mul(off.y).div(rough.add(along * along))).negate());
    };
    const sky = u.skyGlow.mul(exp(max(back.y, 0.0).mul(-4.5)).mul(0.9).add(0.1));
    const galaxyRoad = road(GALAXY_DIR, 0.2, 0.1).mul(GALAXY_ROAD)
        .add(road(GALAXY_DIR, 0.55, 0.3).mul(GALAXY_ROAD * 0.16));
    const farRoad = road(FAR_LAMP_DIR, 0.035, 0.03).mul(u.farLamp).mul(FAR_ROAD);
    // The lamp itself, on whatever facet is tipped to it (its image is off the frame's foot).
    const offLamp = back.sub(l);
    const glint = exp(dot(offLamp, offLamp).div(rough.mul(0.5).add(0.02)).negate()).mul(shaded).mul(LAMP_GLINT);
    const mirror = sky.add(galaxyRoad.mul(u.galaxy)).add(farRoad).add(ring.mul(0.9)).mul(fresnel)
        .add(glint.mul(fresnel.mul(0.7).add(0.3)))
        .toVar();

    // ── The smoke lying on it: matte, in drifts ──
    const body = fine ? cnSeaStreaks(u, flat.xz, foot) : float(0.6);
    const skin = body.mul(body).mul(SKIN).add(SKIN_LEAST).toVar();
    // Smoke passes light forward: a crest between the eye and the lamp glows through.
    const against = clamp(dot(ray, l), 0.0, 1.0);
    const through = lamp.mul(pow(against, 3.0)).mul(crest).mul(float(1.0).sub(wrap)).mul(0.5);
    const lg = vec3(GALAXY_DIR[0], GALAXY_DIR[1], GALAXY_DIR[2]);
    const toG = clamp(dot(n, lg).add(0.3).div(1.3), 0.0, 1.0);
    const dim = u.galaxy.mul(toG).mul(GALAXY_LIGHT).add(u.ambient.mul(crest.mul(0.75).add(0.25))).toVar();
    const matte = direct.add(through).add(ring.mul(wrap.mul(0.7).add(0.3)))
        .add(ember.mul(crest.mul(0.5).add(0.5)))
        .add(dim);

    // (A lock's ember burns under the water: its light comes up through it wherever the eye looks.)
    const light = mirror.mul(float(1.0).sub(skin.mul(0.6))).add(matte.mul(skin)).add(ember.mul(EMBER_THROUGH))
        .add(rings.mul(fresnel.mul(0.7).add(0.3)).mul(RIPPLE_LIGHT))
        .toVar();

    // ── White water ──
    if (foam) {
        If(t.lessThan(FOAM_REACH), () => {
            // Its lace is combed by the wind and drifts before it, is bent by the water's own
            // slope, and thins into its mean where a pixel spans a cell.
            const along = dot(flat.xz, vec2(SEA_WIND[0], SEA_WIND[1])).sub(u.time.mul(FOAM_DRIFT));
            const across = dot(flat.xz, vec2(-SEA_WIND[1], SEA_WIND[0]));
            const at = vec2(along.div(FOAM_TILE * 1.9), across.div(FOAM_TILE)).add(slope.mul(0.11)).toVar();
            const lod = max(log2(foot.mul(256 / FOAM_TILE)), 0.0).toVar();
            const large = u.lace(at, lod).toVar();
            const small = u.lace(at.mul(vec2(3.1, 2.3)).add(large.rg.mul(0.07)), lod.add(1.3)).toVar();
            const cover = smoothstep(0.62, 1.05, s.w).mul(0.85).toVar();
            const rim = float(0.0).toVar();
            // Round the rock: a white line where the sea meets it, always, and the wash a breaking
            // wave leaves, wide while it is fresh.
            const shore = length(flat.xz.sub(vec2(ROCK_XZ[0], ROCK_XZ[1])));
            If(shore.lessThan(12.0), () => {
                const near = cnRockDist(u, p.sub(u.pulsar)).toVar();
                const ragged = near.add(large.b.sub(0.5).mul(0.42)).add(small.r.sub(0.4).mul(0.22)).toVar();
                const wide = u.seaRoll.w.mul(2.8).add(0.7);
                const wash = float(1.0).sub(smoothstep(0.0, wide, ragged));
                cover.addAssign(wash.mul(u.seaRoll.w.mul(0.6).add(0.4)));
                rim.assign(float(1.0).sub(smoothstep(0.03, 0.36, ragged)));
                // The water against the rock mirrors the rock: little.
                light.mulAssign(smoothstep(-0.1, 1.1, near).mul(0.6).add(0.4));
            });
            // Fresh foam is whole; as it thins it is first rafts with holes (not every cell keeps
            // its walls), then threads.
            // (The fine threads carry it: a net of large cells alone reads as a honeycomb.)
            const kept = smoothstep(0.42, 0.6, large.b);
            const threads = float(1.0).sub(smoothstep(0.02, 0.11, large.r)).mul(kept).mul(0.45)
                .add(float(1.0).sub(smoothstep(0.03, 0.2, small.g)).mul(0.8).mul(smoothstep(0.25, 0.7, small.b.add(large.r))))
                .add(small.a.mul(0.34));
            const whole = max(smoothstep(0.42, 0.95, cover.add(large.b.sub(0.5).mul(0.3))), rim);
            cover.assign(max(cover, rim));
            const sharp = float(1.0).sub(smoothstep(0.6, 3.0, lod));
            const white = clamp(cover, 0.0, 1.0)
                .mul(mix(float(0.42), mix(clamp(threads, 0.0, 1.0), float(1.0), whole), sharp))
                .mul(float(1.0).sub(smoothstep(FOAM_REACH * 0.6, FOAM_REACH, t)));
            // (White water scatters whatever light there is: the lamp's, the sky's, a ring's.)
            const foamLight = shaded.mul(wrap.mul(0.5).add(0.5))
                .add(fall).add(ring).add(ember)
                .add(dim.mul(2.0))
                .add(u.skyGlow.mul(0.6))
                .mul(FOAM_WHITE);
            light.assign(mix(light, foamLight, clamp(white, 0.0, 1.0)));
        });
    }

    const mist = float(1.0).sub(exp(t.div(MIST_REACH).pow(2.0).negate()));
    return mix(light.mul(u.breath), far, mist).toVar();
}

/**
 * Cosmic Noir — the sea of smoke.
 *
 * A surface, not a volume: smoke lying as a sea, in slow swells with billows heaped on them, combed
 * by the wind and flowing past the rock. It is found along each view ray at the screen's own
 * resolution (steps as long as the ray's clearance over the sea allows, then a secant to the
 * crossing), so its crests are sharp against the dark and its far reaches settle into a level
 * sea under the horizon's mist.
 *
 * It is lit the way smoke is, softly and from one place:
 *   - the lamp: its own light through the slats (their shadows lie on the sea as spokes, and wheel
 *     when the slats turn) and the beam that looks down, raking the swells. Every swell throws a
 *     long shadow away from the rock, found by a few reads of the sea toward the lamp;
 *   - crests between the eye and the lamp glow through (thin smoke passes light forward);
 *   - a light echo is a ring of light that runs out over the sea from the rock;
 *   - a lock's ember glows up through the smoke where the piece went under, and rings of ripples
 *     run out from it;
 *   - the galaxy silvers the slopes that face it and lays a faint road toward itself, and the
 *     starlight keeps the hollows from being holes.
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
    max,
    min,
    mix,
    normalize,
    pow,
    smoothstep,
    sqrt,
    vec2,
    vec3,
} from 'three/tsl';
import {
    PULSAR, ROCK, ROCK_XZ, ROLLER_MEAN, SEA, cnBeam, cnCage, cnLampAt, cnPhase, cnSeaHeight, cnSeaStreaks,
    cnSeaSurface,
} from './cosmic-noir-tsl.js';
import { GALAXY_DIR } from './cosmic-noir-sky.js';

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
const RIPPLE_SPEED = 3.4;
const RIPPLE_WIDTH = 0.42;
const RIPPLE_HEIGHT = 0.16;
/** The galaxy's light on the sea: on slopes that face it, and as a road toward it. */
const GALAXY_LIGHT = 0.036;
const GALAXY_ROAD = 0.13;
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
/** A roller's crest in the sea's own light: the galaxy's share and the lamp's. */
const CREST_GALAXY = 0.03;
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
        Loop(march, () => {
            const sink = sinkAt(t).toVar();
            const p = o.add(ray.mul(t)).toVar();
            const sea = cnSeaHeight(u, p.xz, t.mul(u.pixelAngle).mul(1.4), sink).toVar();
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
            const took = inFringe.mul(inFringe).mul(stride).mul(FRINGE_SMOKE).toVar();
            fringe.addAssign(took);
            fringeAt.addAssign(took.mul(t));
            t.addAssign(stride);
            If(t.greaterThan(SEA.far), () => {
                Break();
            });
        });
        If(found.greaterThan(0.5), () => {
            hitT.assign(tPrev.add(t.sub(tPrev).mul(cPrev).div(max(cPrev.sub(cNow), 1e-5))));
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
 * @param {object} far  what the horizon's mist shows on this bearing (the sky's own light there)
 * @returns {object} a var: its light
 */
export function cnSeaLight(u, o, ray, t, far, { shadow = 8, fine = true } = {}) {
    const sink = sinkAt(t).toVar();
    const flat = o.add(ray.mul(t)).toVar();
    // A pixel at a grazing angle spans a long reach of sea: read it that softly.
    const foot = t.mul(u.pixelAngle).div(sqrt(clamp(ray.y.negate(), 0.03, 1.0))).toVar();
    const s = cnSeaSurface(u, flat.xz, foot, sink, { fine }).toVar();
    const p = vec3(flat.x, s.x.add(SEA.level), flat.z).toVar();
    const slope = vec2(s.y, s.z).toVar();
    const reach = float(SEA.swell + SEA.billow).mul(u.seaHeave);
    // How high on its swell this point rides (0 in a trough, 1 on a crest).
    const crest = smoothstep(-0.75, 0.75, s.x.div(reach)).toVar();

    // ── Locks: an ember under the smoke, and rings of ripples running out from it ──
    const ember = float(0.0).toVar();
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
            if (fine) {
                const ring = b.w.mul(RIPPLE_SPEED);
                const x = away.sub(ring).div(RIPPLE_WIDTH).toVar();
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
    const direct = lamp.mul(wrap).mul(mix(SHADOW_FILL, 1.0, lit));
    // Smoke passes light forward: a crest between the eye and the lamp glows through.
    const against = clamp(dot(ray, l), 0.0, 1.0);
    const through = lamp.mul(pow(against, 3.0)).mul(crest).mul(float(1.0).sub(wrap)).mul(0.5);

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
    const ringLight = echo.mul(ECHO_LIGHT).mul(wrap.mul(0.7).add(0.3)).div(out.div(60.0).pow(2.0).add(1.0));

    // ── The galaxy and the stars ──
    const lg = vec3(GALAXY_DIR[0], GALAXY_DIR[1], GALAXY_DIR[2]);
    const toG = clamp(dot(n, lg).add(0.3).div(1.3), 0.0, 1.0);
    const flatLen = Math.hypot(GALAXY_DIR[0], GALAXY_DIR[2]) || 1;
    const bearingG = vec2(GALAXY_DIR[0] / flatLen, GALAXY_DIR[2] / flatLen);
    const onRoad = pow(clamp(dot(normalize(ray.xz), bearingG), 0.0, 1.0), 14.0);
    const grazing = float(1.0).sub(clamp(dot(n, ray.negate()), 0.0, 1.0));
    const galaxy = u.galaxy.mul(toG.mul(GALAXY_LIGHT).add(onRoad.mul(grazing.mul(grazing)).mul(GALAXY_ROAD)));
    const sky = u.ambient.mul(crest.mul(0.75).add(0.25));

    // The smoke's own streaks: thin sheets and thick, combed by the wind.
    const body = fine ? cnSeaStreaks(u, flat.xz, foot).mul(0.62).add(0.62) : float(0.95);
    // A roller's crest is pale with its own spindrift: it shows the wave coming in, by the galaxy's
    // light far out and by what the lamp lets fall as it nears the rock.
    const under = r.div(PULSAR.coreReach * 1.5);
    const comb = s.w.mul(s.w).mul(u.galaxy.mul(CREST_GALAXY).add(u.coreGain.mul(CREST_FALL).div(under.mul(under).add(1.0))));
    const light = direct.add(through).add(ringLight).add(ember.mul(crest.mul(0.5).add(0.5)))
        .add(comb)
        .add(galaxy.mul(crest.mul(0.6).add(0.4)))
        .add(sky)
        .mul(body)
        .mul(u.breath);
    const mist = float(1.0).sub(exp(t.div(MIST_REACH).pow(2.0).negate()));
    return mix(light, far, mist).toVar();
}

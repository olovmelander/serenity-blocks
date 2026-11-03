/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE SWALLOW FLY-BY (2026-11-03, the owner's choice after the visibility check: "start the
 * swallow fly-by"). The meadow's swallows hunt 60-200 u off the rail and read as specks; now and
 * then one barn swallow sweeps low past the orbs where they live (L16-L24), 16-20 u from the eye,
 * and is gone: the moment a player sees "a swallow".
 *
 * THE ROUTE is world-anchored, flown on the board clock: it comes in from far behind L16's eye
 * (out of every frame), runs up the meadow on the LEFT of the orbs' seats (the rail's glide camera
 * runs ~13 u to their right), a little under the eye, swerving out at every third seat as if
 * snapping an insect, past L24, then climbs and swings away west, out of every frame again. Every
 * seat L16-L24 sees it come in big at the left edge (50-80 px) and dwindle into the meadow ahead.
 * It is a cubic B-spline (C2: no corner in the path, the speed or the bank) through control points
 * spaced evenly along it, so it flies at an even ~38 u/s.
 *   Built from the seated cameras (each orb's rail point + (0, 1.8, 10.2)): a guide polyline left
 * of the seats, smoothed, resampled every 20 u, the jinks pushed out (see the doc). Clear of the
 * eye by >= 15.4 u at every seat, of the glide camera by >= 20 u, of the rail and orbs by >= 18 u,
 * of the ground by >= 40 u and of the tree crowns (odyssey-swallow-flyby test).
 *
 * WHEN: once per `period` on average, each pass starting at its own time inside its period
 * (90-190 s apart). A pass is shown only when it STARTS with the camera inside the meadow stretch
 * (`arm`); one already under way when the board wakes, or begun with the camera elsewhere, stays
 * hidden all through, so the swallow never appears in view: it enters and leaves out of frame.
 * The board's levels are played in their own theme with this world parked (OdysseyMode
 * `_parkOdysseyBoard`), so a pass can never cross a board card or the gameplay HUD; over the map
 * it keeps to the left half of the frame (the orb panel docks on the right) and passes under the
 * HUD when it is already a speck.
 *
 * THE BIRD is one more instance in the swallows' own draw (odyssey-flights.js): the same model,
 * shader, pipeline and keyframed beat; a few quick beats, then a swept glide through each swerve.
 * BISECT LEVER (board): `?odysseyNoSwallowFlyby=1`.
 */
import {
    clamp, float, floor, max, sin,
} from 'three/tsl';
import {
    birdHash, birdHashNode, smootherstep, smootherstepNode,
} from './odyssey-bird-rig.js';

export const ODYSSEY_SWALLOW_FLYBY = Object.freeze({
    /** The B-spline's control points (world). */
    route: Object.freeze([
        [-142.6, 333.6, -73.8], [-139.6, 334.1, -93.7], [-136.7, 334.6, -113.5], [-134.4, 335.6, -133.4],
        [-133.6, 337.5, -153.4], [-140.7, 341.8, -172.4], [-138.7, 343.8, -192.4], [-146.6, 346.9, -210.6],
        [-156.6, 348.8, -227.8], [-165.0, 350.9, -245.9], [-177.6, 355.2, -262.0], [-181.0, 357.1, -282.1],
        [-188.6, 360.1, -300.4], [-193.2, 362.2, -319.7], [-199.3, 364.3, -338.7], [-211.4, 368.5, -356.0],
        [-209.2, 370.3, -377.0], [-213.9, 373.2, -396.2], [-220.6, 375.5, -415.0], [-226.1, 379.2, -433.8],
        [-235.0, 384.5, -450.9], [-248.8, 390.1, -464.3], [-265.2, 395.9, -474.2], [-283.2, 401.9, -480.5],
        [-302.3, 407.7, -482.9], [-321.6, 413.2, -481.7], [-340.4, 418.0, -477.0], [-358.1, 422.3, -468.5],
        [-374.4, 425.8, -457.1], [-389.3, 428.9, -443.7], [-402.9, 431.6, -429.1], [-415.8, 434.0, -413.7],
        [-427.9, 436.2, -398.0], [-439.6, 438.3, -381.8], [-451.0, 440.2, -365.0], [-461.9, 442.0, -348.0],
        [-472.2, 443.7, -330.9], [-482.2, 445.2, -313.5], [-491.8, 446.7, -295.9], [-501.0, 448.1, -278.0],
        [-509.8, 449.5, -260.0], [-518.2, 450.8, -241.8], [-526.2, 452.0, -223.2], [-532.5, 453.1, -207.5],
    ].map((p) => Object.freeze(p))),
    /** Spline segments a second (~38 u/s: the control points are 20 u apart). */
    rate: 1.894,
    /** Mean seconds from one pass to the next ... */
    period: 140,
    /** ... each starting 0-`jitter` s into its period (so 90-190 s apart). */
    jitter: 50,
    seed: 0.37,
    /** A pass is shown only if it starts with the journey progress in here (L16-L24). */
    arm: Object.freeze([0.205, 0.322]),
    /** Seconds its size eases in and out at the route's ends (out of every frame there). */
    ease: 0.35,
    /** Beats in bursts: sin(rate t + offset) above [from, to] beats (a few quick beats, a glide). */
    bursts: Object.freeze([-0.35, 0.15, 4.4]),
    /** It glides through banks steeper than this (rad, eased over the second value). */
    glideBank: Object.freeze([0.55, 0.95]),
});

/** The route's parameter span and a pass's length (s). */
export function swallowFlybyDuration(cfg = ODYSSEY_SWALLOW_FLYBY) {
    return (cfg.route.length - 3) / cfg.rate;
}

/**
 * The pass under way at board clock `t`: its index, start, seconds into it (`tau`), whether it is
 * flying (`active`) and its size (eased at the route's out-of-frame ends).
 */
export function swallowFlybyPassAt(t, cfg = ODYSSEY_SWALLOW_FLYBY, out = {}) {
    const n = Math.floor(t / cfg.period);
    const start = (n * cfg.period) + (cfg.jitter * birdHash((n * 7.13) + (cfg.seed * 31.7)));
    const tau = t - start;
    const D = swallowFlybyDuration(cfg);
    out.index = n;
    out.start = start;
    out.tau = tau;
    out.active = tau >= 0 && tau <= D;
    out.size = smootherstep(0, cfg.ease, tau) * (1 - smootherstep(D - cfg.ease, D, tau));
    return out;
}

/** The uniform cubic B-spline at parameter `s` (0 .. route.length - 3; clamped). */
export function swallowFlybyPointAt(s, cfg = ODYSSEY_SWALLOW_FLYBY, out = [0, 0, 0]) {
    const P = cfg.route;
    const sc = Math.min(P.length - 3, Math.max(0, s));
    const i = Math.min(P.length - 4, Math.floor(sc));
    const u = sc - i;
    const w0 = ((1 - u) ** 3) / 6;
    const w1 = ((3 * u * u * u) - (6 * u * u) + 4) / 6;
    const w2 = ((-3 * u * u * u) + (3 * u * u) + (3 * u) + 1) / 6;
    const w3 = (u * u * u) / 6;
    for (let k = 0; k < 3; k += 1) out[k] = (w0 * P[i][k]) + (w1 * P[i + 1][k]) + (w2 * P[i + 2][k]) + (w3 * P[i + 3][k]);
    return out;
}

const scratch = {};
/** Where the fly-by swallow is at `t` (world), and whether a pass is flying (`shown`). */
export function swallowFlybyPositionAt(t, cfg = ODYSSEY_SWALLOW_FLYBY) {
    const pass = swallowFlybyPassAt(t, cfg, scratch);
    const q = swallowFlybyPointAt(pass.tau * cfg.rate, cfg);
    return {
        x: q[0], y: q[1], z: q[2], shown: pass.active,
    };
}

/** How much of a beat it is in (0 glide .. 1 beating) at `tau` s into a pass, at bank `bank`. */
export function swallowFlybyBeatWeight(tau, bank, cfg = ODYSSEY_SWALLOW_FLYBY) {
    const [b0, b1, br] = cfg.bursts;
    const gate = smootherstep(b0, b1, Math.sin((tau * br) + (cfg.seed * 9)));
    return gate * (1 - smootherstep(cfg.glideBank[0], cfg.glideBank[1], Math.abs(bank)));
}

/**
 * Per pass, once, as it starts: is the camera in the meadow? A pass seen already under way (the
 * first frame, a jump of the clock) is never armed. `step` returns the flag for this frame.
 */
export function createSwallowFlybyArming(cfg = ODYSSEY_SWALLOW_FLYBY) {
    let pass = null;
    let armed = false;
    let lastTime = null;
    const now = {};
    return {
        step(time, progress) {
            swallowFlybyPassAt(time, cfg, now);
            if (!now.active) {
                armed = false;
                pass = null;
            } else if (pass !== now.index) {
                pass = now.index;
                const began = lastTime !== null && lastTime < now.start && (time - lastTime) < 1.0;
                armed = began && progress >= cfg.arm[0] && progress <= cfg.arm[1];
            }
            lastTime = time;
            return armed;
        },
        get armed() { return armed; },
    };
}

// -- the vertex stage's twins (TSL; call inside the position Fn) ---------------------------------

/** `swallowFlybyPassAt` in the vertex stage -> { tau, size } nodes. */
export function swallowFlybyPassNode(t, cfg = ODYSSEY_SWALLOW_FLYBY) {
    const D = swallowFlybyDuration(cfg);
    const n = floor(t.div(cfg.period));
    const start = n.mul(cfg.period).add(birdHashNode(n.mul(7.13).add(cfg.seed * 31.7)).mul(cfg.jitter));
    const tau = t.sub(start);
    const size = smootherstepNode(0.0, cfg.ease, tau).mul(float(1).sub(smootherstepNode(D - cfg.ease, D, tau)));
    return { tau, size };
}

/** `swallowFlybyPointAt` in the vertex stage: `uRoute` a uniformArray of the control points (vec4). */
export function swallowFlybyPointNode(tau, uRoute, cfg = ODYSSEY_SWALLOW_FLYBY) {
    const last = cfg.route.length - 3;
    const s = clamp(tau.mul(cfg.rate), 0.0, last);
    const i = clamp(floor(s), 0.0, last - 1);
    const u = s.sub(i);
    const u2 = u.mul(u);
    const u3 = u2.mul(u);
    const w0 = float(1).sub(u).mul(float(1).sub(u)).mul(float(1).sub(u))
        .div(6.0);
    const w1 = u3.mul(3.0).sub(u2.mul(6.0)).add(4.0).div(6.0);
    const w2 = u3.mul(-3.0).add(u2.mul(3.0)).add(u.mul(3.0)).add(1.0)
        .div(6.0);
    const w3 = u3.div(6.0);
    const at = (k) => uRoute.element(i.add(k + 0.5).toInt()).xyz;
    return at(0).mul(w0).add(at(1).mul(w1)).add(at(2).mul(w2))
        .add(at(3).mul(w3));
}

/** `swallowFlybyBeatWeight` in the vertex stage. */
export function swallowFlybyBeatWeightNode(tau, bank, cfg = ODYSSEY_SWALLOW_FLYBY) {
    const [b0, b1, br] = cfg.bursts;
    const gate = smootherstepNode(b0, b1, sin(tau.mul(br).add(cfg.seed * 9)));
    return gate.mul(float(1).sub(smootherstepNode(cfg.glideBank[0], cfg.glideBank[1], max(bank, bank.negate()))));
}

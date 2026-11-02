// @ts-check
/**
 * THE MASSIF'S IBEX, ALIVE — where they live and how (three-free; odyssey-ibex.js draws them).
 * Chapter 4, the island's second ground animals (2026-11-02).
 *
 * WHERE. A small group of Alpine ibex (a buck, two nannies and a kid) on the shelf at the top of
 * the grey rock band at the massif's foot, east of the rail's climb. Scouted on the REAL rail camera
 * (docs/ODYSSEY_GROUND_ANIMALS_2026-11.md, "Ibex on the rock band"): in frame from L17 to L25 but
 * L23, 150-260 u off; the summit was ruled out (the climb is 170 u and more from any rock there,
 * never against the sky). The shelf (slope under ~0.5) holds their feet; the band below it (slope
 * 1-1.2) is what the ground paints as rock.
 *
 * SIZE. Drawn at three times life (`scale`), like the act's other life: the buck's shoulder is
 * 13 px at 1440p from L19-L21, 19 px at L22, 25 at L24 and 28 at L25.
 *
 * HOW IT MOVES. The red deer's herd code (odyssey-deer-herd.js) poses them: the same 27-bone
 * skeleton, the same planned footfalls (a planted hoof never slides), the same walked curves and
 * stepped turns, the same living head. What the ibex add is the LEAP: between some of their spots
 * they turn to face the landing, crouch, fly a straight line on an arc with the hooves folded up,
 * and land on all four (the fores first), giving with it; every hoof lands where the planner put
 * it and stays there. The kid hops between spots close to its mother.
 *
 * All of it is a function of the board clock: world-anchored and deterministic.
 */
import { buildHerd } from './odyssey-deer-herd.js';

/** The group and its clock. Spots are world (x, z); `size` is a share of a nanny; `horn` scales the horns. */
export const ODYSSEY_IBEX = Object.freeze({
    /** Drawn larger than life, like the act's other life. */
    scale: 3.0,
    /**
     * [first, last] journey progress the group is drawn at. Both ends are where the rock band is out
     * of the frame (odyssey-ground-animals' ibex tests hold the camera to that at every clock phase),
     * so they never appear or leave in view.
     */
    window: Object.freeze([0.179, 0.348]),
    /** Every schedule repeats after about this many seconds of the board clock. */
    loop: 240,
    /** A walking stride (m, life size) and the seconds one takes at a nanny's size. */
    stride: 0.62,
    cycle: 1.2,
    accel: 0.9,
    turnRate: 0.8,
    pivotBack: 0.3,
    swing: 0.38,
    lift: 0.1,
    settleAfter: 0.45,
    settleAt: 0.07,
    /** A grazing head: a goat's shorter neck swung down to the lichen. */
    graze: Object.freeze({
        neck0: 1.5, neck1: 0.45, neck2: 0.35, head: -1.9, dip: 0.1,
    }),
    /**
     * The leap: crouch and give (s), flight time from a short hop to a long leap (s) over `reach`
     * (in sizes), the arc's apex (a share of the size plus a share of the distance), how far the
     * body sinks in the crouch (share of size), how high the hooves fold up in the air.
     */
    leap: Object.freeze({
        crouch: 0.42,
        absorb: 0.5,
        flight: Object.freeze([0.5, 0.82]),
        reach: 3.0,
        apex: 0.3,
        apexPerDistance: 0.2,
        sink: 0.1,
        tuck: 0.2,
    }),
    members: Object.freeze([
        Object.freeze({
            name: 'buck',
            size: 1.18,
            horn: 0.92,
            seed: 7,
            tone: 0.25,
            spots: Object.freeze([[-156, -560], [-150, -562]]),
            leaps: Object.freeze([true, false]),
        }),
        Object.freeze({
            name: 'nanny',
            size: 0.95,
            horn: 0.3,
            seed: 19,
            tone: 0.6,
            spots: Object.freeze([[-148, -566], [-143, -569], [-145, -573]]),
            leaps: Object.freeze([false, false, true]),
        }),
        Object.freeze({
            name: 'nanny',
            size: 1.0,
            horn: 0.33,
            seed: 31,
            tone: 0.8,
            spots: Object.freeze([[-162, -553], [-164, -559], [-160, -564]]),
            leaps: Object.freeze([false, true, false]),
        }),
        Object.freeze({
            name: 'kid',
            size: 0.55,
            horn: 0.1,
            seed: 53,
            tone: 0.45,
            spots: Object.freeze([[-146, -562], [-141, -566], [-140, -570]]),
            leaps: Object.freeze([true, true, false]),
        }),
    ]),
});

/** The group's schedules (built once; pure). Feet come later (planFootfalls). */
export function buildIbexHerd(cfg = ODYSSEY_IBEX) {
    return buildHerd(/** @type {any} */ (cfg));
}

/** Reveal (0 or 1) at journey progress `p`: drawn through the window, never faded in view. */
export function ibexRevealAt(p, cfg = ODYSSEY_IBEX) {
    return p >= cfg.window[0] && p <= cfg.window[1] ? 1 : 0;
}

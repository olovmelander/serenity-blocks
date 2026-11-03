// @ts-check
/**
 * @fileoverview HOW THE HUMPBACKS SWIM on top of their keyed stroke (2026-11-03). Pure: no three.js.
 *
 * The stroke itself is keyed in Blender (scripts/blender/odyssey/odyssey_whales.py, the "Swim"
 * action of humpback-swim.glb: a wave of heave running back along the body to the flukes, one
 * stroke per 4 s). The game adds what a fixed loop can not know:
 *   - the BEAT follows the pace. The routes' pace swells and slackens (odyssey-ocean-roam.js), and
 *     a whale strokes faster when it swims faster. The rate is integrated by the mixer (time x
 *     rate is never taken), so a change of pace never jumps the stroke.
 *   - the CALF beats faster than its mother: a smaller body keeping her pace needs more strokes.
 *   - TURNS bend the body into a C (the head and the flukes toward the inside of the turn), as much
 *     as the turn is tight, capped where a humpback's spine stops; the head leads because the bend
 *     is about the centre of mass, which rides the route. The flippers roll together into the
 *     turn: the inside one dips, the outside one rises. The yaw rate is eased before it gets here,
 *     so the bend comes and goes with the turn and straightens after it.
 */

/** Per actor: seconds per stroke at its route's mean pace. */
export const WHALE_STROKE_S = Object.freeze({ mother: 5.0, calf: 2.7 });

/** The keyed stroke's own length (s): the GLB's Swim action. */
export const WHALE_CLIP_S = 4.0;

export const WHALE_SWIM = Object.freeze({
    /** How strongly the beat follows the pace (1 = in proportion), and its limits. */
    paceGain: 0.8,
    rateMin: 0.7,
    rateMax: 1.35,
    /** The body bends this share of the arc it swims (a rigid whale bends 0, a rope 1)... */
    follow: 0.45,
    /** ...but never more than this in all (rad, nose to flukes). */
    bendMax: 0.5,
    /** The flippers roll into the turn by this much per radian of the body's bend. */
    flipperRoll: 0.35,
});

/**
 * The bones the bend runs through, with their share of it and which way each points (+1 forward
 * from the centre of mass, -1 back): a C is the forward chain yawing one way and the rear chain the
 * other. The rear carries more (the tail stock is the supple part).
 */
export const WHALE_BEND_BONES = Object.freeze([
    Object.freeze({ name: 'head', share: 0.10, dir: 1 }),
    Object.freeze({ name: 'chest', share: 0.12, dir: 1 }),
    Object.freeze({ name: 'spine1', share: 0.12, dir: -1 }),
    Object.freeze({ name: 'spine2', share: 0.15, dir: -1 }),
    Object.freeze({ name: 'spine3', share: 0.17, dir: -1 }),
    Object.freeze({ name: 'stock1', share: 0.18, dir: -1 }),
    Object.freeze({ name: 'stock2', share: 0.16, dir: -1 }),
]);

export const WHALE_FLIPPER_BONES = Object.freeze(['flipper1_L', 'flipper1_R']);

/**
 * How fast the keyed clip plays for an actor swimming at `speed` on a route whose mean pace is
 * `meanSpeed`: its stroke at the mean pace, quicker when it goes faster.
 * @param {number} speed u/s
 * @param {number} meanSpeed u/s
 * @param {'mother'|'calf'} who
 */
export function whaleClipRate(speed, meanSpeed, who) {
    const base = WHALE_CLIP_S / WHALE_STROKE_S[who];
    const ratio = meanSpeed > 0 && Number.isFinite(speed) ? speed / meanSpeed : 1;
    const k = 1 + (WHALE_SWIM.paceGain * (ratio - 1));
    return base * Math.min(WHALE_SWIM.rateMax, Math.max(WHALE_SWIM.rateMin, k));
}

/**
 * The body's whole bend (rad, + = into a left turn) for a yaw rate (rad/s, + = turning left, the
 * world's +y) at a speed (u/s) for a body `length` u long: the share of its arc it follows, capped.
 * @param {number} yawRate
 * @param {number} speed
 * @param {number} length
 */
export function whaleBend(yawRate, speed, length) {
    if (!(speed > 1e-3) || !Number.isFinite(yawRate)) return 0;
    const arc = (yawRate / speed) * length;
    const b = arc * WHALE_SWIM.follow;
    // A soft cap (tanh): the bend eases into its limit instead of stopping on it.
    return WHALE_SWIM.bendMax * Math.tanh(b / WHALE_SWIM.bendMax);
}

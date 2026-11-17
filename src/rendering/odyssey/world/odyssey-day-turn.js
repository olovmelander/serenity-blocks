/**
 * THE DAY TURNS — the island's morning becomes the mountains' afternoon (masterpiece pass,
 * 2026-11-17).
 *
 * Chapters 3 and 4 used to share one noon, and the seam between them was not a moment: nothing
 * happened. The colour script now gives each its own hour (`island-morning`, `mountain-afternoon`,
 * `alpine-gold` and the script's `hour`), and this module is how the world gets from one to the
 * other between the island's last orb and the mountains' first.
 *
 * WHAT THE EYE SEES. A cloud's shadow comes up the valley from the south-east shore behind the
 * eye: the meadow goes into soft, cool shade, then the forest's edge, then the shade climbs the
 * massif. Behind it the light comes back, and it is the afternoon's: warm light floods the meadow
 * and follows the shade up the mountain, the last of the morning leaving the summit. It is the
 * world's own cloud shadow (the ground, the forest and the boulders read it where they read the
 * drifting ones), keyed to rail progress and nothing else, so it stands still at a parked orb and
 * a slow scroll walks it across the island by hand.
 *
 * WHY NOT A CLOUD THE RAIL FLIES THROUGH. The two orbs either side of the seam stand ~33 u apart
 * and the eye rides ~55 u over the meadow, level: a bank of cloud across the rail there is a wall
 * a few metres behind the island's last orb, and it hides the tarn and the massif that orb is
 * framed on. The shade keeps both views whole.
 *
 * Pure schedule + pure TSL builders (inputs are nodes or plain numbers; nothing is captured), so
 * the world material owns its uniforms and a test can read the schedule without three.js.
 */
import {
    Fn, If, dot, float, smoothstep, vec2,
} from 'three/tsl';

/**
 * The turn's place and shape.
 *
 * `window` is in ACT II progress (the world's `update` clock: (p - 0.0649) / 0.6894), from just
 * after the island's last orb parks (journey p 0.2323) to just before the mountains' first orbs
 * park (p 0.2689), so every parked view is wholly one hour or the other; its test pins both ends
 * to the live layout. The colour script's two keyframes stand at the same two places.
 *
 * The shade travels along `heading` (x, z; unit), measured from `origin` (x, z; a point on the
 * rail inside the window). `travel` is where its leading edge stands over the window, as
 * [share of the window, distance along the heading]: quick over the open sea either side of the
 * island (nothing reads it there), and most of the window spent crossing the land the eye sees.
 */
export const ODYSSEY_DAY_TURN = Object.freeze({
    window: Object.freeze([0.2445, 0.2940]),
    heading: Object.freeze([-0.6, -0.8]),
    origin: Object.freeze([-150, -255]),
    travel: Object.freeze([
        Object.freeze([0.00, -4600]),
        Object.freeze([0.10, -700]),
        Object.freeze([0.90, 3300]),
        Object.freeze([1.00, 5600]),
    ]),
    /**
     * The shade's depth along the heading, and the width of its edges (world units). The edges are
     * a cloud shadow's, not a fade's: the first cut's were 320 u wide, and from an orb's close-up
     * (a few hundred units of meadow in view) the whole frame dimmed and brightened at once,
     * which is a fade. At ~100 u the edge of the light is a line the eye sees cross the meadow.
     */
    width: 950,
    soft: 110,
    /**
     * Its outline: `ragged` is how far the great billows carry an edge (± world units) and their
     * size (world units a tile); `scallop` the same for the cumulus heads along it.
     */
    ragged: Object.freeze([280, 2300]),
    scallop: Object.freeze([120, 610]),
    /**
     * The share of the direct light it takes (the drifting shadows take 0.46), and how much more of
     * the sky's hue the land's shade takes under it (over the ground's own share): in a cloud's
     * shadow the land is lit by the sky alone, so the shade is cool and silver, not only darker.
     */
    depth: 0.60,
    silver: 0.32,
    /** Where in the shade the new light arrives: [from, to] as shares of its depth from the back. */
    relight: Object.freeze([0.0, 0.7]),
    /**
     * THE SHADE KEEPS A CLOUD'S PACE. A glide between two orbs crosses the whole window in about a
     * third of a second (filmed): at the rail's pace the shade would cross the island in a blink
     * and the day would turn as a cut. So the turn follows the rail no faster than this: the whole
     * crossing takes at least `seconds`, however fast the eye travels, and finishes round the eye
     * as it arrives at the new orb. A slow scroll is slower than that and walks it by hand; a
     * clock that jumps by more than `maxStep` (a capture's scrub, a paused tab) lands it at once.
     */
    seconds: 3.0,
    maxStep: 0.5,
});

const clamp01 = (x) => Math.min(Math.max(Number.isFinite(x) ? x : 0, 0), 1);

/** Where the shade's leading edge stands at share `t` of the window (world units along the heading). */
export function dayTurnFront(t, cfg = ODYSSEY_DAY_TURN) {
    const at = clamp01(t);
    const stops = cfg.travel;
    let i = 0;
    while (i < stops.length - 2 && at > stops[i + 1][0]) i += 1;
    const [t0, f0] = stops[i];
    const [t1, f1] = stops[i + 1];
    return f0 + ((f1 - f0) * clamp01((at - t0) / (t1 - t0)));
}

/**
 * Where Act II progress `actT` stands in the turn's window (pure; continuous in `actT`).
 * @param {number} actT 0..1 across Act II
 * @param {object} [cfg]
 * @returns {{t:number, on:boolean}} `t` the linear share 0..1 of the window, `on` whether the
 *   rail stands inside it. (The turn itself follows the colour script's eased share of its two
 *   keyframes, `createDayTurnPace`; both are 0 before the window and 1 after it.)
 */
export function dayTurnAt(actT, cfg = ODYSSEY_DAY_TURN) {
    const [a, b] = cfg.window;
    const t = clamp01((actT - a) / (b - a));
    return { t, on: t > 0 && t < 1 };
}

const LIGHT_SLOTS = Object.freeze(['skyHorizon', 'skyZenith', 'sun', 'groundShadow']);
const LIGHT_SCALARS = Object.freeze(['hour', 'fogDensity']);
/** What the land needs of the light either side of the shade (its sun, softened toward the sky). */
const SIDE_SLOTS = Object.freeze(['sun', 'skyHorizon']);

/**
 * THE TURN, PACED (see `seconds`): one per world. `step` takes the colour script's sample for this
 * frame and where the rail stands, and answers with the light the world wears now.
 *
 * Only the turn itself is paced. `from` and `to` are the script's samples at the two ends of the
 * window; their difference is the turn's whole change of light. The script's sample at any
 * progress has taken a share `s` of that change (0 before the window, 1 after it), the shade has
 * carried a share `t` of it across the island, and the light now is the sample with the
 * difference between the two put back: `sample + (t - s) x change`. At rest `t` is `s` and the
 * light is the script's own, exactly; everything else the script does (the breach before the
 * turn, the gold deepening after it) follows the rail with no lag at all.
 * @param {object} from  `sampleColourScript` at the window's start
 * @param {object} to    `sampleColourScript` at the window's end
 * @param {object} [cfg]
 */
export function createDayTurnPace(from, to, cfg = ODYSSEY_DAY_TURN) {
    let t = null;
    let lastTime = null;
    const side = () => ({ sun: [0, 0, 0], skyHorizon: [0, 0, 0], hour: 0 });
    const out = {
        t: 0, front: cfg.travel[0][1], on: false, ahead: side(), behind: side(),
    };
    const hourSpan = to.hour - from.hour;
    return {
        /**
         * @param {object} sample  this frame's `sampleColourScript` result; its light slots, `hour`
         *   and `fogDensity` are REWRITTEN to the light now
         * @param {number} actT    0..1 across Act II
         * @param {number} time    world seconds
         * @returns {{t:number, front:number, on:boolean, ahead:object, behind:object}} the paced
         *   turn, and the land's light ahead of the shade and behind it ({sun, skyHorizon, hour});
         *   the same object every call
         */
        step(sample, actT, time) {
            // The share of the turn the script's own sample has taken (its hour is the measure):
            // where the turn stands at rest, and what the paced turn follows.
            let s = actT >= cfg.window[1] ? 1 : 0;
            if (actT > cfg.window[0] && actT < cfg.window[1] && hourSpan > 1e-6) {
                s = clamp01((sample.hour - from.hour) / hourSpan);
            }
            const dt = lastTime === null ? 0 : time - lastTime;
            lastTime = time;
            if (t === null || !(dt > 0) || dt > cfg.maxStep) t = s;
            else t += Math.min(Math.max(s - t, -dt / cfg.seconds), dt / cfg.seconds);
            const lag = t - s;
            for (let i = 0; i < SIDE_SLOTS.length; i += 1) {
                const slot = SIDE_SLOTS[i];
                for (let c = 0; c < 3; c += 1) {
                    const change = to[slot][c] - from[slot][c];
                    out.ahead[slot][c] = Math.max(sample[slot][c] - (s * change), 0);
                    out.behind[slot][c] = Math.max(sample[slot][c] + ((1 - s) * change), 0);
                }
            }
            out.ahead.hour = Math.max(sample.hour - (s * hourSpan), 0);
            out.behind.hour = Math.max(sample.hour + ((1 - s) * hourSpan), 0);
            if (lag !== 0) {
                for (let i = 0; i < LIGHT_SLOTS.length; i += 1) {
                    const slot = LIGHT_SLOTS[i];
                    for (let c = 0; c < 3; c += 1) {
                        sample[slot][c] = Math.max(sample[slot][c] + (lag * (to[slot][c] - from[slot][c])), 0);
                    }
                }
                for (let i = 0; i < LIGHT_SCALARS.length; i += 1) {
                    const slot = LIGHT_SCALARS[i];
                    sample[slot] = Math.max(sample[slot] + (lag * (to[slot] - from[slot])), 0);
                }
            }
            out.t = t;
            out.front = dayTurnFront(t, cfg);
            out.on = t > 0 && t < 1;
            return out;
        },
    };
}

/**
 * The turn at a point of the land, as a TSL node: vec2(shade, turned).
 *   shade  0..1  how deep the point stands in the cloud's shadow
 *   turned 0..1  how much of its light is already the afternoon's
 * Outside the window `turn.z` is 0 and the branch is not taken: (0, 0), at the cost of one compare.
 * @param {object} xz    vec2 node, world x/z
 * @param {object} turn  vec4 uniform node: (front, width, on 0|1, depth)
 * @param {{billow: (uv: object) => object, scallop: (uv: object) => object}} noise  two tiling
 *   0..1 fields read at a uv (float nodes): a smooth one for the shade's great billows and a
 *   cumulus silhouette for the heads along its edge. Pinned to a mip by the caller, so the reads
 *   are legal in the vertex stage and inside the branch.
 * @param {object} [cfg]
 */
export function dayTurnField(xz, turn, noise, cfg = ODYSSEY_DAY_TURN) {
    return Fn(() => {
        const out = vec2(0, 0).toVar();
        If(turn.z.greaterThan(0.5), () => {
            const outline = noise.billow(xz.div(cfg.ragged[1])).sub(0.5).mul(2 * cfg.ragged[0])
                .add(noise.scallop(xz.div(cfg.scallop[1]).add(vec2(0.37, 0.61))).sub(0.5).mul(2 * cfg.scallop[0]));
            const along = dot(xz.sub(vec2(cfg.origin[0], cfg.origin[1])), vec2(cfg.heading[0], cfg.heading[1]))
                .add(outline)
                .toVar();
            const back = turn.x.sub(turn.y).toVar();
            const reached = float(1).sub(smoothstep(turn.x.sub(cfg.soft), turn.x, along));
            const left = float(1).sub(smoothstep(back.sub(cfg.soft), back, along));
            const turned = float(1).sub(smoothstep(
                back.add(turn.y.mul(cfg.relight[0])),
                back.add(turn.y.mul(cfg.relight[1])),
                along,
            ));
            out.assign(vec2(reached.mul(float(1).sub(left)), turned));
        });
        return out;
    })();
}

/**
 * THE HOUR'S LOOK — what the colour script's `hour` scales, each at hour 1 (the sun on the
 * horizon). The mountains end their chapter at hour ~0.6.
 *
 *   shadeChroma    more of the sky's hue in the land's shade (vegetation's noon share is 0.25: the
 *                  measured law that grass shade is not blue; long evening shadows are)
 *   snowShadeChroma  the same on snow, over its noon 0.62
 *   shadeDeep      how much of the sky's fill the shade loses (under a low sun the fill is a
 *                  smaller share of the light, so long shadows stand deeper against the lit land)
 *   alpenglow      lit snow leans to `alpenglowTint` (rose over the sun's gold): the light on a
 *                  snowfield late in the day is pinker than the sun that casts it
 *   cloudSun       how far the white of a cumulus' lit side and sunward rim is the sun's colour
 *   warmAir        the warm air toward the sun, over its noon gain
 *   antiRose       the rose low in the sky opposite the sun (the belt over the Earth's shadow)
 *   mist, mistVeil the mist low on the land: its density and the most it may veil, as multiples
 *                  of noon's (added)
 *   capGold        the gold on the trees' sunlit caps (see the fields)
 */
export const ODYSSEY_HOUR_LOOK = Object.freeze({
    shadeChroma: 0.38,
    snowShadeChroma: 0.20,
    shadeDeep: 0.22,
    alpenglow: 0.85,
    alpenglowTint: Object.freeze([1.0, 0.80, 0.74]),
    cloudSun: 1.0,
    warmAir: 0.70,
    antiRose: 0.55,
    antiRoseTint: Object.freeze([0.98, 0.74, 0.58]),
    mist: 2.8,
    mistVeil: 0.8,
    /** The crowns' sunlit caps: how fast they go to gold (all of it by hour 1 / capGold), the
     * tint they reach over their own colour and the cap's added reach. */
    capGold: 1.7,
    capGoldTint: Object.freeze([1.42, 1.19, 0.72]),
    capGoldGain: 0.4,
    /** The hour the clouds' light and the mist hold at through the evening (the mountains' last). */
    hourHeld: 0.66,
    /** The share of the evening's dusk over which the hour's warm air and belt hand over to it. */
    eveningHandover: 0.2,
});

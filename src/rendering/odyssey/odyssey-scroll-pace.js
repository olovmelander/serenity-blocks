// @ts-check
/**
 * THE SCROLL'S PACE THROUGH THE CLIMB INTO SPACE (2026-10-25).
 *
 * Olov: "when scrolling with the mouse pad it gets a rapid speed when it goes up the mountainside,
 * pass the clouds out in space!!"
 *
 * The wheel moves the journey's progress at one rate everywhere, and progress is distance along
 * the rail (~25 u per 0.01 everywhere). But from late chapter 5 the picture changes far faster per
 * unit of progress than anywhere else: the climb above the clouds multiplies the eye's apparent
 * height by up to ~1.7x per 0.01 (world/odyssey-world-act-gate.js `worldClimbScale`), and the view
 * leans 26 deg down over the Earth and back (composition/odyssey-orbit-earth.js). A touchpad swipe,
 * which reaches the scroll's speed cap easily, crossed the whole climb, the Earth's arrival and its
 * sunset in about a second.
 *
 * So the wheel slows where the picture changes fastest, by the same schedules that change it: the
 * rate of the climb (in the logarithm of the height), the rate of the lean, and the sunset sweeping
 * the Earth below (the sun's elevation while the Earth is there and the sun near its horizon).
 * Elsewhere it is 1. Pure: the camera controller reads it for each wheel step and for its speed cap.
 *
 * TUNED ON THE LIVE JOURNEY (2026-10-25): the mean change of the frame per 0.002 of progress (luma,
 * 0-255, a repeated frame's noise taken off) is 2-4 through chapter 5's sky and was 9-15 through the
 * climb and the Earth's arrival at the old flat pace (to 0.6-6.5 with the first, climb-and-lean-only
 * pace). With these rates the climb runs at 1-4 (one breath of ~7 as the nearest cumulus passes),
 * a little under the sky's own pace: it is the journey's climax, taken slowly. The passage from the
 * clouds to the rail's return (p 0.66-0.80) takes ~2.8x the wheel of a stretch of sky.
 */
import { worldClimbScale } from './world/odyssey-world-act-gate.js';
import { orbitEarthAt } from './composition/odyssey-orbit-earth.js';

export const ODYSSEY_SCROLL_PACE = Object.freeze({
    /** The climb's rate (|d ln scale| per 0.01 of progress) at which the wheel runs at half speed. */
    climbRate: 0.33,
    /** The lean's rate (deg per 0.01 of progress) at which the wheel runs at half speed. */
    leanRate: 8,
    /** The sunset's rate over the Earth (deg of the sun's elevation per 0.01) at half speed... */
    sunsetRate: 2.6,
    /** ...counted while the sun is near this elevation (deg; a Gaussian this wide). */
    sunsetAt: 3,
    sunsetWidth: 10,
    /** Never slower than this share of the wheel's speed. */
    floor: 0.15,
    /** The progress step the rates are measured over (either side). */
    step: 0.002,
});

const ln = (x) => Math.log(Math.max(x, 1e-6));
const DEG = 180 / Math.PI;

/**
 * The wheel's pace at journey progress `progress`: 1 elsewhere, down to `floor` where the climb
 * into space changes the picture fastest.
 * @param {number} progress global journey progress
 * @param {number[] | null | undefined} chapterPositions the live chapter boundaries
 * @returns {number} 0 < pace <= 1
 */
export function odysseyScrollPace(progress, chapterPositions) {
    const P = ODYSSEY_SCROLL_PACE;
    const skyStart = chapterPositions?.[4];
    const actEnd = chapterPositions?.[5];
    if (!Number.isFinite(progress) || !Number.isFinite(skyStart) || !Number.isFinite(actEnd)) return 1;
    const h = P.step;
    const per = 0.01 / (2 * h);
    const climb = Math.abs(ln(worldClimbScale(progress + h, skyStart, actEnd))
        - ln(worldClimbScale(progress - h, skyStart, actEnd))) * per;
    const ahead = orbitEarthAt(progress + h, chapterPositions);
    const behind = orbitEarthAt(progress - h, chapterPositions);
    const here = orbitEarthAt(progress, chapterPositions);
    const lean = Math.abs(ahead.lookDownDeg - behind.lookDownDeg) * per;
    const sunDeg = here.sunElevation * DEG;
    const sunset = Math.abs(ahead.sunElevation - behind.sunElevation) * DEG * per * here.presence
        * Math.exp(-(((sunDeg - P.sunsetAt) / P.sunsetWidth) ** 2));
    const pace = 1 / (1 + (climb / P.climbRate) + (lean / P.leanRate) + (sunset / P.sunsetRate));
    return Math.max(P.floor, Math.min(1, pace));
}

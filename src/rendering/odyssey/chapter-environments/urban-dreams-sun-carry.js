/**
 * @fileoverview THE 7->8 CARRY — the black hole's light becomes the city's sun (seamless pass).
 *
 * One schedule, read by BOTH chapters so they can never disagree: chapter 7 glides Gargantua
 * off its camera lock onto the Retrosun's direction, closes the shadow and swells the photon
 * ring while a copy of the Retrosun (the same builder, the same uniforms, oriented on the
 * city's up) fills the closing hole; chapter 8 keeps its own Retrosun dark until the hand-over
 * and then takes over from the copy, pixel for pixel. The bloom swell is the sun's own light.
 *
 * Authored as fractions of the 7->8 seam window, [ch8Start - w, ch8Start + w] with w chapter
 * 7's seam half-width, so the carry tracks the crossfade through any re-layout.
 */

import { getChapterTransitionForChapter } from './shared/chapter-profile.js';

export const CH7_SUN_CARRY = Object.freeze({
    // Gargantua leaves its lock and settles on the sun's direction.
    glideEnd: 0.5,
    // The shadow contracts to nothing (the eclipse ending in reverse).
    closeStart: 0.12,
    closeEnd: 0.55,
    // The sun copy and the photon ring's swell fill in as the shadow closes.
    fillStart: 0.06,
    fillEnd: 0.5,
    // The thin disk band, its lensed fold arcs and the infall embers collapse into the light.
    bandFadeEnd: 0.42,
    // Dust, shards and the far starfield are gone by the boundary: no chapter-7 motif lingers
    // over the city.
    motifExitEnd: 0.5,
    // The copy hands the sun to chapter 8 here (both drawn identically, so the swap is exact).
    handover: 0.56,
    // The glide target is held within this angle of the view axis (rad), so the hero never
    // leaves the frame even if the sun is still off-screen when the window opens.
    maxOffAxis: 0.42,
});

function smoothstep01(x) {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
}

/**
 * @param {number} progress global path progress
 * @param {number[]} chapterPositions the active layout's chapter starts
 * @returns {null|{glide:number, close:number, fill:number, band:number, motifs:number,
 *   handedOver:boolean, active:boolean}} null when progress/layout is unknown
 */
export function resolveSunCarry(progress, chapterPositions) {
    const ch8Start = chapterPositions?.[7];
    if (!Number.isFinite(progress) || !Number.isFinite(ch8Start)) return null;
    const w = getChapterTransitionForChapter(7)?.seamWidth ?? 0.0162;
    const start = ch8Start - w;
    const width = 2 * w;
    const C = CH7_SUN_CARRY;
    const ramp = (a, b) => smoothstep01((progress - (start + a * width)) / ((b - a) * width));
    return {
        glide: ramp(0, C.glideEnd),
        close: ramp(C.closeStart, C.closeEnd),
        fill: ramp(C.fillStart, C.fillEnd),
        band: 1 - ramp(0, C.bandFadeEnd),
        motifs: 1 - ramp(0, C.motifExitEnd),
        handedOver: progress >= start + C.handover * width,
        active: progress > start,
    };
}

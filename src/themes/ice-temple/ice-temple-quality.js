/**
 * Ice Temple — content tiers.
 *
 * reflection   planar reflector resolution scale for the ice floor (0 = mirror the analytic sky)
 * veils        parallax layers of fracture veils inside the columns (1..3)
 * fineCracks   the finer cracks inside the floor's plates
 * bubbles      layers of frozen bubbles under the floor (0 = none)
 * curtains     aurora curtains (1..5)
 * snow         snowflakes
 * dust         diamond-dust glints
 * mist         drifting mist banks over the ice (0 = none)
 * shards       event ice-chip pool
 * crown        the ring of spikes a hard drop raises
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        reflection: 0, veils: 1, fineCracks: false, bubbles: 0, curtains: 2, snow: 900, dust: 320, mist: 0, shards: 72, crown: false,
    }),
    Low: Object.freeze({
        reflection: 0, veils: 2, fineCracks: true, bubbles: 0, curtains: 3, snow: 1800, dust: 640, mist: 0, shards: 128, crown: true,
    }),
    Medium: Object.freeze({
        reflection: 0.4, veils: 2, fineCracks: true, bubbles: 2, curtains: 4, snow: 3200, dust: 1300, mist: 12, shards: 256, crown: true,
    }),
    High: Object.freeze({
        reflection: 0.5, veils: 3, fineCracks: true, bubbles: 3, curtains: 4, snow: 5200, dust: 2200, mist: 18, shards: 384, crown: true,
    }),
    Ultra: Object.freeze({
        reflection: 0.65, veils: 3, fineCracks: true, bubbles: 3, curtains: 5, snow: 7600, dust: 3200, mist: 24, shards: 512, crown: true,
    }),
    Extreme: Object.freeze({
        reflection: 0.8, veils: 3, fineCracks: true, bubbles: 3, curtains: 5, snow: 10000, dust: 4400, mist: 30, shards: 768, crown: true,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}

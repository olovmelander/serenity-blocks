/**
 * Kaleidosonic — content tiers. Every tier keeps the whole picture and every event.
 *
 * steps        march budget of a view ray through the temple
 * folds        most folds of the field (the trance grows the temple finer up to this)
 * shadowSteps  a short soft shadow toward the core (0 = none)
 * strikes      most locks' wavefronts ringing at once (the newest are kept)
 * jewelCells   lattice cells a ray's walk visits for the jewels it passes
 * veins        the veins' strength (a small buffer draws each line many screen pixels wide)
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        steps: 34, folds: 7, shadowSteps: 0, strikes: 6, jewelCells: 5, veins: 0.5,
    }),
    Low: Object.freeze({
        steps: 46, folds: 8, shadowSteps: 0, strikes: 8, jewelCells: 6, veins: 0.62,
    }),
    Medium: Object.freeze({
        steps: 66, folds: 9, shadowSteps: 0, strikes: 10, jewelCells: 8, veins: 0.85,
    }),
    High: Object.freeze({
        steps: 96, folds: 10, shadowSteps: 0, strikes: 12, jewelCells: 10, veins: 1,
    }),
    Ultra: Object.freeze({
        steps: 120, folds: 10, shadowSteps: 12, strikes: 12, jewelCells: 10, veins: 1,
    }),
    Extreme: Object.freeze({
        steps: 150, folds: 11, shadowSteps: 18, strikes: 12, jewelCells: 12, veins: 1,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}

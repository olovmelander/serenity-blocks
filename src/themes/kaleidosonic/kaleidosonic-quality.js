/**
 * Kaleidosonic — content tiers. Every tier keeps the whole picture and every event.
 *
 * steps        march budget of a view ray through the temple
 * folds        most folds of the field (the trance grows the temple finer up to this)
 * strikes      most locks' wavefronts ringing at once (the newest are kept)
 * jewelCells   lattice cells a ray's walk visits for the jewels it passes
 * veins        the veins' strength (a small buffer draws each line many screen pixels wide)
 * lightMap     texels a side of the light map (kaleidosonic-light.js): the stone's shadows from the
 *              core and the jewels, and the shadows that cut their beams into shafts
 * lightSteps   march budget of each of the light map's directions
 * airCells     cells of the view ray's walk whose jewel's beams are shadowed by the light map (the
 *              core's beams always are)
 * airBeamCells cells whose jewel's beams are drawn at all (the furthest keep only its glow)
 * glossCells   cells the reflected ray's walk visits for the jewels each pearl mirrors
 * beamAxes     the gem's facet axes that throw beams (6: twelve beams; 3: six)
 * stoneBeams   whether the beams brighten the stone where they land (the air carries them either way)
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        steps: 34,
        folds: 7,
        strikes: 6,
        jewelCells: 5,
        veins: 0.5,
        lightMap: 96,
        lightSteps: 32,
        airCells: 0,
        airBeamCells: 0,
        glossCells: 0,
        beamAxes: 3,
        stoneBeams: false,
    }),
    Low: Object.freeze({
        steps: 46,
        folds: 8,
        strikes: 8,
        jewelCells: 6,
        veins: 0.62,
        lightMap: 128,
        lightSteps: 36,
        airCells: 1,
        airBeamCells: 1,
        glossCells: 1,
        beamAxes: 3,
        stoneBeams: false,
    }),
    Medium: Object.freeze({
        steps: 66,
        folds: 9,
        strikes: 10,
        jewelCells: 8,
        veins: 0.85,
        lightMap: 192,
        lightSteps: 44,
        airCells: 2,
        airBeamCells: 2,
        glossCells: 1,
        beamAxes: 6,
        stoneBeams: true,
    }),
    High: Object.freeze({
        steps: 96,
        folds: 10,
        strikes: 12,
        jewelCells: 10,
        veins: 1,
        lightMap: 256,
        lightSteps: 52,
        airCells: 2,
        airBeamCells: 3,
        glossCells: 2,
        beamAxes: 6,
        stoneBeams: true,
    }),
    Ultra: Object.freeze({
        steps: 120,
        folds: 10,
        strikes: 12,
        jewelCells: 10,
        veins: 1,
        lightMap: 320,
        lightSteps: 60,
        airCells: 3,
        airBeamCells: 4,
        glossCells: 2,
        beamAxes: 6,
        stoneBeams: true,
    }),
    Extreme: Object.freeze({
        steps: 150,
        folds: 11,
        strikes: 12,
        jewelCells: 12,
        veins: 1,
        lightMap: 384,
        lightSteps: 64,
        airCells: 3,
        airBeamCells: 5,
        glossCells: 3,
        beamAxes: 6,
        stoneBeams: true,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}

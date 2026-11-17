/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE FOLD'S EIGHT PLACES — chapter 7 inside the hole (masterpiece pass, 2026-11-17).
 *
 * The fold was one kaleidoscope corridor whose crystals changed from orb to orb: eight orbs of
 * "rings round a white light". It is now eight PLACES, each with its own geometry, light and sense
 * of scale, and none of them a corridor round a light (one file each, in fold-places/):
 *
 *  0 THE TIDE      an ocean of liquid colour overhead, a black mirror below, a low light on the
 *                  horizon between them, threads of light standing from the one into the other
 *                  (orbs 49 and 50: Fluid Dreams, Nebula Flow)
 *  1 THE LATTICE   beams of gold in an endless lattice that winds through itself, one hand
 *                  through the other (orb 51)
 *  2 THE NAVE      a pointed vault over a polished floor, storm light in tall windows, slow
 *                  arcs crawling its ribs (orb 52: Voltage Storm)
 *  3 THE FLOCK     veils of motes of light wheeling over a dusk horizon (orb 53: Murmuration)
 *  4 THE STAIRS    flights of glass stairs with three different downs, climbing for ever
 *                  (orb 54: Serenity Warp)
 *  5 THE JEWEL     the inside of a cut gem, the journey's earlier worlds in its facets
 *                  (orb 55: Kaleidosonic)
 *  6 THE PAINT     strokes of thick colour hanging in the dark, each its own pigment
 *                  (orb 56: Chromatic Impasto)
 *  7 THE HALL      the way out: a hall whose walls straighten into the city's neon grid
 *
 * Each is a function of the view ray in the room's frame (+z ahead, +x right, +y up) with the eye
 * at the origin, travelling along +z by the warp drive's phase. Four are met ANALYTICALLY (planes,
 * a vault, a gem's facets, a hall), so they are exact at any distance and cost a few noise taps;
 * four are WALKED (the lattice and the stairs along the ray, the flock and the paint layer by
 * layer), with the walk's steps from the quality tier.
 *
 * VALUES. The Odyssey's post (chapter 7's bloom and grade) lifts everything about two stops: a
 * place is authored dark (grounds near 0.005, bodies under 0.15, only lines and lights near 1),
 * so it comes out luminous with its blacks kept, and the orbs and the rail stay the brightest
 * things in it. Judge a place only through the post (`effect=ch7-fold-places`, or the game).
 */
import { FLOCK, placeFlock } from './fold-places/fold-flock.tsl.js';
import { HALL, placeHall } from './fold-places/fold-hall.tsl.js';
import { JEWEL, placeJewel } from './fold-places/fold-jewel.tsl.js';
import { LATTICE, placeLattice } from './fold-places/fold-lattice.tsl.js';
import { NAVE, placeNave } from './fold-places/fold-nave.tsl.js';
import { PAINT, placePaint } from './fold-places/fold-paint.tsl.js';
import { STAIRS, placeStairs } from './fold-places/fold-stairs.tsl.js';
import { TIDE, placeTide } from './fold-places/fold-tide.tsl.js';

/** The places' ids (the shader's branch values): one list, kept where the rooms are (three-free). */
export { CH7_FOLD_PLACE_IDS as CH7_FOLD_PLACES } from '../transitions/odyssey-fold-rooms.js';

/** Each place's own numbers (its frame's turn from the view, its sizes), by name. */
export const CH7_FOLD_PLACE = Object.freeze({
    tide: TIDE, lattice: LATTICE, nave: NAVE, flock: FLOCK, stairs: STAIRS, jewel: JEWEL, paint: PAINT, hall: HALL,
});

/** The places, by id: each a builder of one room's colour for a ray (call inside a Fn). */
export const CH7_FOLD_PLACE_BUILDERS = Object.freeze([
    placeTide, placeLattice, placeNave, placeFlock, placeStairs, placeJewel, placePaint, placeHall,
]);

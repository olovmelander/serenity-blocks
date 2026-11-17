// @ts-check
/**
 * @fileoverview THE CITY BEYOND THE CITY (2026-11-17 masterpiece pass), three-free plan.
 *
 * The dealt city (odyssey-neon-city-plan.js) is six banks wide and ends 640 u down the boulevard:
 * from the street the skyline cards carry it on, but the journey's end rises over the roofs, and
 * from up there the city ended in a bare edge. This deals the districts beyond it: low towers on a
 * jittered grid out to the haze, taller where a district's centre is (a few clusters), none inside
 * the dealt city's own footprint, and none in the wedge of ground behind the Retrosun's disc (the
 * disc is a quad 700 u down the boulevard: a tower behind it would be drawn over by the sun).
 */

import {
    CH8_CITY_LAYOUT, RETROSUN_CITY_POS, STREET_Y, mulberry32,
} from './odyssey-neon-city-plan.js';
import { latticeNoise3Cpu } from './odyssey-lattice-noise.js';

export const NEON_FAR_CITY = Object.freeze({
    /** The grid's pitch and the reach of the far city from its centre (corridor units). */
    pitch: 62,
    centre: Object.freeze([0, -180]),
    reach: 2050,
    /** The dealt city's footprint, with a margin: no far tower stands inside it. */
    cityHalfWidth: 352,
    cityZ: Object.freeze([-672, 402]),
    /** The wedge behind the sun's disc, seen from the rail: |x| < margin + slope * (z past the disc). */
    sunWedge: Object.freeze({ slope: 0.27, margin: 150 }),
    heights: Object.freeze([16, 62]),
    districtLift: 110,
    tallChance: 0.035,
    tallRange: Object.freeze([150, 240]),
    seed: 0x0fa2c17,
});

/**
 * Deal the far towers.
 * @param {{ stride?: number }} [options] 2 keeps every other tower (the Medium tier)
 * @returns {{ x: number, y: number, z: number, width: number, height: number, depth: number,
 *   seed: number, lit: number, hue: number, crown: number }[]} y is the box centre
 */
export function dealFarCity({ stride = 1 } = {}) {
    const F = NEON_FAR_CITY;
    const rand = mulberry32(F.seed);
    const towers = [];
    const half = Math.ceil(F.reach / F.pitch);
    const sunZ = RETROSUN_CITY_POS[2];
    let index = 0;
    for (let gz = -half; gz <= half; gz += 1) {
        for (let gx = -half; gx <= half; gx += 1) {
            // Every draw is made for every cell, so a thinned tier keeps the same towers.
            const jx = (rand() - 0.5) * 0.5;
            const jz = (rand() - 0.5) * 0.5;
            const hRoll = rand();
            const tallRoll = rand();
            const tallHeight = rand();
            const wRoll = rand();
            const dRoll = rand();
            const keepRoll = rand();
            const seed = rand() * 100;
            const litRoll = rand();
            const hueRoll = rand();
            const crownRoll = rand();
            const x = F.centre[0] + ((gx + jx) * F.pitch);
            const z = F.centre[1] + ((gz + jz) * F.pitch);
            const r = Math.hypot(x - F.centre[0], z - F.centre[1]);
            if (r > F.reach) continue;
            if (Math.abs(x) < F.cityHalfWidth && z > F.cityZ[0] && z < F.cityZ[1]) continue;
            if (z < sunZ + 20 && Math.abs(x) < F.sunWedge.margin + (F.sunWedge.slope * (sunZ + 20 - z))) continue;
            // Thinner toward the edge: the city peters out into the haze.
            if (keepRoll > 1 - (0.55 * (r / F.reach))) continue;
            index += 1;
            if (stride > 1 && index % stride !== 0) continue;
            // Districts: a slow noise lifts whole neighbourhoods into clusters of taller towers.
            const district = latticeNoise3Cpu((x / 420) + 31.7, 2.5, (z / 420) + 11.3);
            const lift = Math.max(0, (district - 0.52) / 0.48);
            let height = F.heights[0] + (hRoll * (F.heights[1] - F.heights[0])) + (lift * lift * F.districtLift * (0.4 + hRoll));
            if (tallRoll < F.tallChance + (lift * 0.08)) {
                height = F.tallRange[0] + (tallHeight * (F.tallRange[1] - F.tallRange[0]));
            }
            const width = 26 + (wRoll * 24);
            const depth = 26 + (dRoll * 24);
            towers.push({
                x,
                y: STREET_Y + (height * 0.5),
                z,
                width,
                height,
                depth,
                seed,
                lit: 0.05 + (litRoll * 0.2) + (lift * 0.12),
                hue: hueRoll,
                crown: height > 120 || crownRoll < 0.12 ? 1 : 0,
            });
        }
    }
    return towers;
}

/** The dealt city's reach along the boulevard, for callers that need to stay clear of it. */
export const NEON_CITY_SPAN_Z = Object.freeze([CH8_CITY_LAYOUT.farZ, CH8_CITY_LAYOUT.nearZ]);

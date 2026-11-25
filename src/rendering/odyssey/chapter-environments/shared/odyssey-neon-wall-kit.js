// @ts-check
/**
 * @fileoverview THE WALLS' KIT, three-free plan (2026-11-25).
 *
 * The boulevard's two inner walls are what the arrival stands between and what every close-up
 * looks along, 25 to 40 u from the eye. The facade's shader gives them depth; this hangs real
 * things on them, as boxes for the rooftops' one instanced draw (no draw and no pipeline more):
 *
 *   balconies     stacks of them up a wall, a bay or two wide, each a slab and a front, a lamp by
 *                 some of the doors;
 *   air units     under windows here and there, as a dense city wears them;
 *   drain pipes   down the wall from the parapet to the street;
 *   fire escapes  landings and their stairs zigzagging up a masonry wall;
 *   awnings       over the open shopfronts, lit from under: the street floor seen from above;
 *   brackets      the two arms every blade sign hangs from (they used to float off the wall);
 *   street lamps  down both kerbs, and the signals over each crossing.
 *
 * Everything keeps clear of the signs, the screens and the skybridges fixed to the same wall, and
 * stands on the facade's own bays and storeys (odyssey-neon-architecture.js facadeBays).
 */

import { STREET_Y, mulberry32 } from './odyssey-neon-city-plan.js';
import { NEON_STYLE, facadeBays } from './odyssey-neon-architecture.js';

/** Kit kinds (the gear shader's `kind`, after the roof gear's 0..6). */
export const NEON_KIT_KIND = Object.freeze({
    slab: 10, front: 11, wallUnit: 12, pipe: 13, landing: 14, stair: 15, awning: 16, bracket: 17, post: 18, lamp: 19, signal: 20,
});

/** Lamp colours (the gear shader's `glow`): 0 is no light. */
export const NEON_KIT_GLOW = Object.freeze({
    none: 0, warm: 1, white: 2, cyan: 3, rose: 4, amber: 5, signal: 6,
});

export const NEON_WALL_KIT = Object.freeze({
    /** The stretch of the boulevard the kit dresses (corridor z): what the eye passes and sees near. */
    zNear: 150,
    zFar: -250,
    balconyOut: 1.15,
    unitOut: 0.55,
    /** Street lamps: every `lampEvery` down each kerb, `lampX` from the centre line, this tall. */
    lampEvery: 22,
    lampX: 21.2,
    lampHeight: 7.5,
    /** How far a lamp's head hangs out over the road from its post, and each kerb's stagger in z. */
    lampReach: 2.0,
    lampStagger: 5.5,
    /** A crossing every `crossEvery` (the street's own zebra), offset as the street paints it. */
    crossEvery: 90,
    crossAt: -37,
});

/**
 * Plan the kit.
 * @param {object[]} bases planNeonArchitecture().bases (the dealt towers with their style and tint)
 * @param {object[]} [signs] planNeonSigns().signs
 * @param {{x: number, y: number, z: number}[]} [bridges] seatNeonSkybridges()
 * @returns {{ boxes: object[] }}
 */
export function planNeonWallKit(bases, signs = [], bridges = []) {
    const W = NEON_WALL_KIT;
    const K = NEON_KIT_KIND;
    const G = NEON_KIT_GLOW;
    /** @type {any[]} */
    const boxes = [];

    bases.forEach((base) => {
        if (base.bank !== 0 || base.z > W.zNear || base.z < W.zFar) return;
        const rand = mulberry32(0x6b17 + Math.imul(Math.floor(base.seed * 1000) + 3, 2671) + (base.rank * 59));
        /** @param {number} a @param {number} b */
        const range = (a, b) => a + (rand() * (b - a));
        const { side, style, tint } = base;
        const wallX = side * (Math.abs(base.x) - (base.width * 0.5));
        // Out of the wall, toward the lane.
        const out = -side;
        const {
            corner, bays, bayW, storey,
        } = facadeBays(style, base.depth);
        const z0 = base.z - (base.depth * 0.5) + corner;
        const floors = Math.floor((base.height - 1.2) / storey);
        const bayZ = (/** @type {number} */ k) => z0 + ((k + 0.5) * bayW);
        const floorY = (/** @type {number} */ j) => STREET_Y + (j * storey);

        // What is already fixed to this wall: [zLo, zHi, yLo, yHi] each.
        /** @type {number[][]} */
        const taken = [];
        signs.forEach((sign) => {
            if (sign.roof || sign.side !== side) return;
            if (Math.abs(sign.z - base.z) > (base.depth * 0.5) + 6) return;
            if ((sign.facing ?? 0) === 0 && sign.vertical) {
                taken.push([sign.z - 1.6, sign.z + 1.6, sign.y - (sign.h * 0.5) - 1, sign.y + (sign.h * 0.5) + 1]);
                // The blade's two arms (its own wall's: a neighbour's blade is only kept clear of).
                if (Math.abs(sign.z - base.z) > base.depth * 0.5) return;
                const reach = 0.9 + 0.3;
                [-1, 1].forEach((end) => {
                    boxes.push({
                        x: wallX + (out * reach * 0.5), y: sign.y + (end * ((sign.h * 0.5) - 0.7)), z: sign.z - 0.12, width: reach, height: 0.16, depth: 0.16, tint, kind: K.bracket,
                    });
                });
            } else if ((sign.facing ?? 0) === 1) {
                taken.push([sign.z - (sign.w * 0.5) - 0.6, sign.z + (sign.w * 0.5) + 0.6, sign.y - (sign.h * 0.5) - 0.6, sign.y + (sign.h * 0.5) + 0.6]);
            }
        });
        bridges.forEach((bridge) => {
            if (Math.abs(bridge.z - base.z) > (base.depth * 0.5) + 6) return;
            taken.push([bridge.z - 5.5, bridge.z + 5.5, bridge.y - 4.6, bridge.y + 4.6]);
        });
        const free = (/** @type {number} */ zLo, /** @type {number} */ zHi, /** @type {number} */ yLo, /** @type {number} */ yHi) => !taken
            .some((t) => zLo < t[1] && zHi > t[0] && yLo < t[3] && yHi > t[2]);
        const take = (/** @type {number} */ zLo, /** @type {number} */ zHi, /** @type {number} */ yLo, /** @type {number} */ yHi) => {
            taken.push([zLo, zHi, yLo, yHi]);
        };

        const masonry = style === NEON_STYLE.punched || style === NEON_STYLE.piers;
        const homes = style === NEON_STYLE.punched || style === NEON_STYLE.ribbon;

        // ── Awnings over the open shopfronts ──
        for (let k = 0; k < bays; k += 1) {
            const span = rand() < 0.4 ? 2 : 1;
            if (rand() < 0.42 && k + span <= bays) {
                const zc = z0 + ((k + (span * 0.5)) * bayW);
                const glow = [G.warm, G.rose, G.cyan, G.amber, G.white][Math.floor(rand() * 5)];
                boxes.push({
                    x: wallX + (out * 0.8), y: STREET_Y + storey + 0.1, z: zc, width: 1.6, height: 0.14, depth: (span * bayW) - 0.3, tint: rand(), kind: K.awning, glow,
                });
                k += span - 1;
            }
        }

        // ── A fire escape up a masonry wall ──
        if (masonry && bays >= 4 && floors >= 6 && rand() < 0.62) {
            const k0 = 1 + Math.floor(rand() * (bays - 3));
            const zLo = z0 + (k0 * bayW) + 0.15;
            const zHi = z0 + ((k0 + 2) * bayW) - 0.15;
            // The longest clear run of storeys in this pair of bays (a dozen at most).
            let runFrom = -1;
            let best = [0, 0];
            for (let j = 2; j <= floors; j += 1) {
                const clear = j < floors && free(zLo, zHi, floorY(j) - 0.3, floorY(j + 1));
                if (clear && runFrom < 0) runFrom = j;
                if (!clear && runFrom >= 0) {
                    if (j - runFrom > best[1] - best[0]) best = [runFrom, j];
                    runFrom = -1;
                }
            }
            best[1] = Math.min(best[1], best[0] + 12);
            if (best[1] - best[0] >= 4) {
                const reach = 1.15;
                const xc = wallX + (out * reach * 0.5);
                for (let j = best[0]; j < best[1]; j += 1) {
                    const y = floorY(j) + 0.3;
                    boxes.push({
                        x: xc, y, z: (zLo + zHi) * 0.5, width: reach, height: 0.1, depth: zHi - zLo, tint, kind: K.landing,
                    });
                    // Its rails.
                    [0.55, 1.05].forEach((up) => {
                        boxes.push({
                            x: wallX + (out * (reach - 0.04)), y: y + up, z: (zLo + zHi) * 0.5, width: 0.07, height: 0.07, depth: zHi - zLo, tint, kind: K.stair,
                        });
                    });
                    if (j + 1 < best[1]) {
                        // The stair to the next landing, the other way each storey.
                        const run = (zHi - zLo) - 1.4;
                        const dir = (j - best[0]) % 2 === 0 ? 1 : -1;
                        boxes.push({
                            x: wallX + (out * 0.42), y: y + (storey * 0.5), z: (zLo + zHi) * 0.5, width: 0.62, height: 0.1, depth: Math.hypot(run, storey), tint, kind: K.stair, tilt: -dir * Math.atan2(storey, run),
                        });
                    }
                }
                take(zLo - 0.2, zHi + 0.2, floorY(best[0]) - 0.5, floorY(best[1]) + 1.2);
            }
        }

        // ── Balcony stacks on the walls people live behind ──
        if (homes && floors >= 5) {
            const stacks = rand() < 0.5 ? 2 : 1;
            for (let s = 0; s < stacks; s += 1) {
                const wide = bays >= 5 && rand() < 0.5 ? 2 : 1;
                const k0 = Math.floor(rand() * (bays - wide + 1));
                const zLo = z0 + (k0 * bayW) + 0.12;
                const zHi = z0 + ((k0 + wide) * bayW) - 0.12;
                const jFrom = 2 + Math.floor(rand() * 3);
                const jTo = Math.max(jFrom + 2, floors - Math.floor(rand() * 3));
                for (let j = jFrom; j < jTo; j += 1) {
                    const y = floorY(j);
                    if (!free(zLo, zHi, y - 0.2, y + 1.3)) continue;
                    boxes.push({
                        x: wallX + (out * W.balconyOut * 0.5), y: y + 0.06, z: (zLo + zHi) * 0.5, width: W.balconyOut, height: 0.16, depth: zHi - zLo, tint, kind: K.slab,
                    });
                    boxes.push({
                        x: wallX + (out * (W.balconyOut - 0.05)), y: y + 0.62, z: (zLo + zHi) * 0.5, width: 0.1, height: 1.0, depth: zHi - zLo, tint, kind: K.front,
                    });
                    if (rand() < 0.3) {
                        boxes.push({
                            x: wallX + (out * 0.12), y: y + 2.3, z: zLo + 0.3, width: 0.16, height: 0.16, depth: 0.16, tint, kind: K.lamp, glow: rand() < 0.8 ? G.warm : G.white,
                        });
                    }
                    take(zLo, zHi, y - 0.2, y + 1.3);
                }
            }
        }

        // ── Air units under windows ──
        if (style !== NEON_STYLE.curtain) {
            const odds = masonry ? 0.13 : 0.07;
            for (let j = 2; j < floors; j += 1) {
                for (let k = 0; k < bays; k += 1) {
                    if (rand() >= odds) continue;
                    const zc = bayZ(k) + range(-0.25, 0.25);
                    const y = floorY(j) + 0.52;
                    if (!free(zc - 0.6, zc + 0.6, y - 0.4, y + 0.4)) continue;
                    boxes.push({
                        x: wallX + (out * W.unitOut * 0.5), y, z: zc, width: W.unitOut, height: 0.62, depth: 0.95, tint, kind: K.wallUnit,
                    });
                }
            }
        }

        // ── Drain pipes, parapet to street ──
        const pipes = masonry ? 2 : 1;
        for (let p = 0; p < pipes; p += 1) {
            const k = Math.floor(rand() * (bays + 1));
            const zc = z0 + (k * bayW);
            const top = base.height - range(0.6, 2.4);
            boxes.push({
                x: wallX + (out * 0.14), y: STREET_Y + (top * 0.5) + 1.5, z: zc, width: 0.24, height: top - 3, depth: 0.24, tint, kind: K.pipe,
            });
        }
    });

    // ── Street lamps down both kerbs, and the signals over each crossing ──
    for (let z = W.zNear; z > W.zFar - 200; z -= W.lampEvery) {
        [-1, 1].forEach((side) => {
            const x = side * W.lampX;
            const zz = z + (side * W.lampStagger);
            boxes.push({
                x, y: STREET_Y + (W.lampHeight * 0.5), z: zz, width: 0.16, height: W.lampHeight, depth: 0.16, tint: 0.5, kind: K.post,
            });
            boxes.push({
                x: x - (side * W.lampReach * 0.5), y: STREET_Y + W.lampHeight, z: zz, width: W.lampReach + 0.2, height: 0.1, depth: 0.1, tint: 0.5, kind: K.post,
            });
            boxes.push({
                x: x - (side * W.lampReach), y: STREET_Y + W.lampHeight - 0.16, z: zz, width: 1.1, height: 0.22, depth: 0.5, tint: 0.5, kind: K.lamp, glow: NEON_KIT_GLOW.amber,
            });
        });
    }
    for (let z = W.crossAt + (3 * W.crossEvery); z > W.zFar - 200; z -= W.crossEvery) {
        [-1, 1].forEach((side) => {
            const x = side * 19.6;
            const zz = z + (side * 4.6);
            boxes.push({
                x, y: STREET_Y + 3.4, z: zz, width: 0.26, height: 6.8, depth: 0.26, tint: 0.5, kind: K.post,
            });
            boxes.push({
                x: x - (side * 4.2), y: STREET_Y + 6.7, z: zz, width: 8.4, height: 0.2, depth: 0.2, tint: 0.5, kind: K.post,
            });
            [3.2, 7.6].forEach((reach, n) => {
                boxes.push({
                    x: x - (side * reach), y: STREET_Y + 6.1, z: zz, width: 0.5, height: 1.1, depth: 0.4, tint: n / 2, kind: K.signal, glow: NEON_KIT_GLOW.signal,
                });
            });
        });
    }
    return { boxes };
}

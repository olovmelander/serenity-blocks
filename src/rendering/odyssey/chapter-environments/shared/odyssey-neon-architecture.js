// @ts-check
/**
 * @fileoverview THE CITY'S ARCHITECTURE (2026-11-17 masterpiece pass), three-free plan.
 *
 * The dealt towers (odyssey-neon-city-plan.js) were single boxes: a city of dark slabs. This gives
 * each one a building's shape, from its own seed, without moving any of them:
 *
 *   a style      punched windows in concrete, ribbon glazing, a glass curtain wall, or stone piers
 *                with narrow lights between them (`style` 0..3), and a tint for its masonry;
 *   setbacks     tall towers step in once or twice above the height their signs hang at (the walls
 *                the signs, screens and skybridges are fixed to stay exactly where they were), with
 *                a ledge at each step;
 *   a crown      a pyramid cap, a mast with a beacon, or both, on the tall ones;
 *   a roof       a plant-room penthouse, a water tank on legs, air handlers, an aerial, a cornice:
 *                the eye flies over most of the city's roofs.
 *
 * Products: `bases` (one per dealt tower, in the dealt order: the tower's box, lowered to its first
 * setback), `tiers` (the upper tiers, penthouses and ledges: more boxes for the same facade
 * material), and `gear` (masts, air handlers and tank legs as boxes, pyramid caps, tanks, beacons)
 * for the rooftop draws.
 */

import { STREET_Y, mulberry32 } from './odyssey-neon-city-plan.js';

export const NEON_STYLE = Object.freeze({
    punched: 0, ribbon: 1, curtain: 2, piers: 3,
});

/** Facade parts (the shader's `part`): a storey-bearing box, a ledge slab. */
export const NEON_PART = Object.freeze({ body: 0, ledge: 1 });

export const NEON_ARCHITECTURE = Object.freeze({
    /** Style odds for an ordinary tower (punched, ribbon, curtain, piers). */
    styleOdds: Object.freeze([0.32, 0.24, 0.22, 0.22]),
    /** A tower steps in only if it is this tall and has this much left above its signs. */
    setbackMinHeight: 68,
    setbackMinRoom: 18,
    /** How far a ledge stands out from the wall under it, and how thick it is. */
    ledgeOut: 0.45,
    ledgeThick: 0.85,
    /** Room kept clear over the highest sign fixed to a tower. */
    signMargin: 2.5,
});

/**
 * Which dealt tower a sign is fixed to (-1 if none): wall signs hang on the boulevard's inner
 * towers, screens on the face of a tall one, roof signs stand on a low roof.
 */
function towerOfSign(sign, towers) {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < towers.length; i += 1) {
        const t = towers[i];
        const dz = Math.abs(sign.z - t.z) - (t.depth * 0.5);
        const dx = Math.abs(sign.x - t.x) - (t.width * 0.5);
        const d = Math.max(dx, 0) + Math.max(dz, 0);
        if (d < bestDistance) {
            bestDistance = d;
            best = i;
        }
    }
    return bestDistance < 6 ? best : -1;
}

/**
 * Plan every tower's shape.
 * @param {ReturnType<import('./odyssey-neon-city-plan.js').dealCityTowers>} towers
 * @param {object[]} [signs] planNeonSigns().signs
 * @returns {{
 *   bases: object[], tiers: object[],
 *   gear: { boxes: object[], pyramids: object[], tanks: object[], beacons: object[] },
 * }}
 */
export function planNeonArchitecture(towers, signs = []) {
    const A = NEON_ARCHITECTURE;
    // The height (above the street) each tower's wall must stay flush to, and the roofs a sign
    // stands on.
    const clear = new Float32Array(towers.length);
    const roofBusy = new Uint8Array(towers.length);
    signs.forEach((sign) => {
        const index = towerOfSign(sign, towers);
        if (index < 0) return;
        if (sign.roof) roofBusy[index] = 1;
        else clear[index] = Math.max(clear[index], (sign.y + (sign.h * 0.5) - STREET_Y) + A.signMargin);
    });

    const bases = [];
    const tiers = [];
    const gear = {
        boxes: [], pyramids: [], tanks: [], beacons: [],
    };
    towers.forEach((tower, index) => {
        // The tower's own generator: adding a tower elsewhere never changes this one.
        const rand = mulberry32(0x41c7 + Math.imul(Math.floor(tower.seed * 1000) + 1, 7919) + (tower.rank * 131) + (tower.bank * 17));
        const range = (a, b) => a + (rand() * (b - a));
        let style = 0;
        const roll = rand();
        let acc = 0;
        for (let k = 0; k < A.styleOdds.length; k += 1) {
            acc += A.styleOdds[k];
            if (roll <= acc) { style = k; break; }
            style = k;
        }
        if (tower.hero > 0) style = rand() < 0.6 ? NEON_STYLE.curtain : NEON_STYLE.piers;
        const tint = rand();
        const H = tower.height;
        const look = {
            seed: tower.seed, occupancy: tower.occupancy, warmBias: tower.warmBias, hero: tower.hero, style, tint,
        };
        const part = (x, z, width, depth, from, to, kind = NEON_PART.body) => ({
            ...look,
            x,
            z,
            width,
            depth,
            height: to - from,
            y: STREET_Y + ((from + to) * 0.5),
            base: from,
            part: kind,
        });
        const ledge = (x, z, width, depth, at) => {
            tiers.push(part(x, z, width + (2 * A.ledgeOut), depth + (2 * A.ledgeOut), at - (A.ledgeThick * 0.5), at + (A.ledgeThick * 0.5), NEON_PART.ledge));
        };

        const room = H - clear[index];
        const tall = H > 110 || tower.hero > 0;
        const steps = H >= A.setbackMinHeight && room >= A.setbackMinRoom && rand() < (tall ? 0.96 : 0.6);
        let top = {
            x: tower.x, z: tower.z, width: tower.width, depth: tower.depth,
        };
        let baseTop = H;
        if (steps) {
            const first = Math.max(clear[index], H * range(0.42, 0.62));
            const rest = H - first;
            if (rest >= 10) {
                baseTop = first;
                const span = Math.min(tower.width, tower.depth);
                const inset1 = Math.max(1.6, span * range(0.09, 0.16));
                const two = rest > 26 && rand() < 0.8;
                const mid = two ? first + (rest * range(0.5, 0.68)) : H;
                ledge(tower.x, tower.z, tower.width, tower.depth, first);
                const t2 = {
                    x: tower.x, z: tower.z, width: tower.width - (2 * inset1), depth: tower.depth - (2 * inset1),
                };
                tiers.push(part(t2.x, t2.z, t2.width, t2.depth, first, mid));
                top = t2;
                if (two) {
                    const inset2 = Math.max(1.4, span * range(0.08, 0.14));
                    const t3 = {
                        x: tower.x, z: tower.z, width: t2.width - (2 * inset2), depth: t2.depth - (2 * inset2),
                    };
                    if (t3.width > 5 && t3.depth > 5) {
                        ledge(t2.x, t2.z, t2.width, t2.depth, mid);
                        tiers.push(part(t3.x, t3.z, t3.width, t3.depth, mid, H));
                        top = t3;
                    } else {
                        tiers[tiers.length - 1].height = H - first;
                        tiers[tiers.length - 1].y = STREET_Y + ((first + H) * 0.5);
                    }
                }
            }
        }
        bases.push({
            ...tower,
            ...look,
            height: baseTop,
            y: STREET_Y + (baseTop * 0.5),
            base: 0,
            part: NEON_PART.body,
            fullHeight: H,
        });

        // ── The roof ──
        const roofY = STREET_Y + H;
        const busy = roofBusy[index] === 1;
        // A cornice on the masonry styles.
        if (!busy && (style === NEON_STYLE.punched || style === NEON_STYLE.piers) && rand() < 0.7) {
            ledge(top.x, top.z, top.width, top.depth, H - 0.2);
        }
        if (tall) {
            // A crown: a pyramid cap on the stone towers, a mast on the glass ones, some get both.
            const capped = style === NEON_STYLE.piers || rand() < 0.35;
            let tip = roofY;
            if (capped) {
                const capHeight = Math.min(top.width, top.depth) * range(0.55, 1.0);
                gear.pyramids.push({
                    x: top.x, y: roofY + (capHeight * 0.5), z: top.z, width: top.width * 0.94, height: capHeight, depth: top.depth * 0.94, tint, hero: tower.hero,
                });
                tip += capHeight;
            }
            if (!capped || rand() < 0.6) {
                const mast = range(14, 34);
                gear.boxes.push({
                    x: top.x, y: tip + (mast * 0.5), z: top.z, width: 0.8, height: mast, depth: 0.8, tint, kind: 1,
                });
                tip += mast;
            }
            gear.beacons.push({
                x: top.x, y: tip + 0.6, z: top.z, phase: rand(), hue: 0,
            });
        } else if (!busy) {
            const roofRoom = Math.min(top.width, top.depth);
            if (rand() < 0.62 && roofRoom > 12) {
                // The plant room: a penthouse off-centre, with a few windows of its own.
                const pw = top.width * range(0.32, 0.56);
                const pd = top.depth * range(0.32, 0.56);
                const px = top.x + ((top.width - pw) * range(-0.3, 0.3));
                const pz = top.z + ((top.depth - pd) * range(-0.3, 0.3));
                const ph = range(3.4, 7.5);
                tiers.push(part(px, pz, pw, pd, H, H + ph));
            }
            if ((style === NEON_STYLE.punched || style === NEON_STYLE.piers) && rand() < 0.42 && roofRoom > 13) {
                // A water tank on legs.
                const r = range(2.0, 3.1);
                const tx = top.x + (top.width * range(-0.28, 0.28));
                const tz = top.z + (top.depth * range(-0.28, 0.28));
                const legs = range(2.2, 3.6);
                const body = range(3.6, 5.2);
                gear.tanks.push({
                    x: tx, y: roofY + legs + (body * 0.5), z: tz, width: r * 2, height: body, depth: r * 2, tint,
                });
                [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
                    gear.boxes.push({
                        x: tx + (sx * r * 0.62), y: roofY + (legs * 0.5), z: tz + (sz * r * 0.62), width: 0.34, height: legs, depth: 0.34, tint, kind: 0,
                    });
                });
            }
            // Air handlers.
            const units = Math.floor(rand() * 3.2);
            for (let k = 0; k < units; k += 1) {
                const w = range(2.2, 4.4);
                const d = range(2.0, 3.6);
                const h = range(1.3, 2.4);
                gear.boxes.push({
                    x: top.x + (top.width * range(-0.36, 0.36)),
                    y: roofY + (h * 0.5),
                    z: top.z + (top.depth * range(-0.36, 0.36)),
                    width: w,
                    height: h,
                    depth: d,
                    tint,
                    kind: 2,
                });
            }
            if (rand() < 0.16) {
                // An aerial with a light on it.
                const mast = range(8, 17);
                const mx = top.x + (top.width * range(-0.3, 0.3));
                const mz = top.z + (top.depth * range(-0.3, 0.3));
                gear.boxes.push({
                    x: mx, y: roofY + (mast * 0.5), z: mz, width: 0.5, height: mast, depth: 0.5, tint, kind: 1,
                });
                gear.beacons.push({
                    x: mx, y: roofY + mast + 0.4, z: mz, phase: rand(), hue: rand() < 0.3 ? 1 : 0,
                });
            }
        }
    });
    return { bases, tiers, gear };
}

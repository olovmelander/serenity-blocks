// @ts-check
/**
 * @fileoverview THE CITY'S ARCHITECTURE, three-free plan (2026-11-17; rebuilt 2026-11-25).
 *
 * The dealt towers (odyssey-neon-city-plan.js) are parcels: a place, a footprint, a height. This
 * gives each one a building's shape, from its own seed, without moving any of them:
 *
 *   a style      punched windows in concrete, ribbon glazing, a glass curtain wall, or stone piers
 *                with narrow lights between them (`style` 0..3), and a tint for its masonry. The
 *                style's module (NEON_FACADE_MODULE: bay, storey, corner, how deep the glass sits)
 *                is shared with the facade's shader and with the wall kit, so a balcony stands
 *                under a window;
 *   a form       above the height its signs hang at (the walls the signs, screens and skybridges
 *                are fixed to stay exactly where they were) a tower steps in once or twice, stands
 *                its shaft off to a corner over a terrace, parts into two slabs, carries a drum, or
 *                rises as a slender shaft from a broad base; a ledge at each step;
 *   a crown      a pyramid cap, a mast, a stepped top, a tiara of fins, or several, on the tall ones;
 *                a helipad on a few tall flat ones;
 *   a roof       a plant-room penthouse, a water tank on legs, air handlers, runs of duct, an
 *                aerial, a cornice: the eye flies over most of the city's roofs.
 *
 * Products: `bases` (one per dealt tower, in the dealt order: the tower's box, lowered to its first
 * setback), `tiers` (the upper tiers, penthouses and ledges: more boxes for the same facade
 * material), `rounds` (drums: the same material on a prism), and `gear` (masts, fins, air handlers,
 * ducts and tank legs as boxes, pyramid caps, tanks, beacons) for the rooftop draws.
 */

import { STREET_Y, mulberry32 } from './odyssey-neon-city-plan.js';

export const NEON_STYLE = Object.freeze({
    punched: 0, ribbon: 1, curtain: 2, piers: 3,
});

/**
 * Facade parts (the shader's `part`): a storey-bearing box, a ledge slab, a drum. A part that
 * carries the tower's top adds NEON_PART_TOP, one whose roof is a helipad NEON_PART_PAD as well.
 */
export const NEON_PART = Object.freeze({ body: 0, ledge: 1, round: 2 });
export const NEON_PART_TOP = 4;
export const NEON_PART_PAD = 8;

/** A part's kind (one of NEON_PART), without the flags it may carry. @param {number} part */
export const neonPartKind = (part) => part % NEON_PART_TOP;

/** Roof gear kinds (the gear shader's `kind`; the wall kit's follow in odyssey-neon-wall-kit.js). */
export const NEON_GEAR_KIND = Object.freeze({
    leg: 0, mast: 1, unit: 2, cap: 3, tank: 4, duct: 5, fin: 6,
});

/**
 * Each style's window module (corridor units, index = style): the bay it aims for, its storey, the
 * solid corner, the window's opening as fractions of a bay and a storey, how far the glass sits
 * behind the wall's face.
 */
export const NEON_FACADE_MODULE = Object.freeze({
    bay: Object.freeze([2.1, 2.7, 1.55, 2.45]),
    storey: Object.freeze([3.1, 3.25, 3.45, 3.2]),
    corner: Object.freeze([0.75, 0.3, 0.14, 1.05]),
    loX: Object.freeze([0.17, 0.02, 0.04, 0.3]),
    loY: Object.freeze([0.27, 0.34, 0.3, 0.14]),
    hiY: Object.freeze([0.86, 0.86, 0.97, 0.92]),
    recess: Object.freeze([0.42, 0.3, 0.1, 0.58]),
});

/**
 * How a face `faceW` wide is divided: a whole number of bays between two solid corners (the
 * shader's own sum, in JavaScript: the wall kit hangs things on these bays).
 * @param {number} style @param {number} faceW
 */
export function facadeBays(style, faceW) {
    const M = NEON_FACADE_MODULE;
    const corner = M.corner[style];
    const span = Math.max(faceW - (2 * corner), 0.5);
    const bays = Math.max(Math.floor((span / M.bay[style]) + 0.5), 1);
    return {
        corner, bays, bayW: span / bays, storey: M.storey[style],
    };
}

export const NEON_ARCHITECTURE = Object.freeze({
    /** Style odds for an ordinary tower (punched, ribbon, curtain, piers). */
    styleOdds: Object.freeze([0.3, 0.22, 0.26, 0.22]),
    /** A tower takes a form only if it is this tall and has this much left above its signs. */
    setbackMinHeight: 62,
    setbackMinRoom: 16,
    /** How far a ledge stands out from the wall under it, and how thick it is. */
    ledgeOut: 0.45,
    ledgeThick: 0.85,
    /** Room kept clear over the highest sign fixed to a tower. */
    signMargin: 2.5,
    /** Form odds (stepped, offset, twin, drum, core) for a tower that takes one. */
    formOdds: Object.freeze([0.3, 0.22, 0.16, 0.14, 0.18]),
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
 * The towers the rail runs between (the boulevard's two inner banks, from behind the eye's first
 * station to a block past its last, the end of the line at z -123 since the city grew longer):
 * their walls are the player's first sight of the city, fill a third of those frames and stand
 * round every close-up, so more of their rooms are lit.
 * @returns {number} added to the tower's occupancy
 */
export function arrivalLife(tower) {
    if (tower.bank > 1) return 0;
    const fromFar = Math.min(1, Math.max(0, (tower.z + 270) / 60));
    const fromBehind = Math.min(1, Math.max(0, (150 - tower.z) / 40));
    return (tower.bank === 0 ? 0.3 : 0.2) * fromFar * fromBehind;
}

/**
 * Plan every tower's shape.
 * @param {ReturnType<import('./odyssey-neon-city-plan.js').dealCityTowers>} towers
 * @param {object[]} [signs] planNeonSigns().signs
 * @returns {{
 *   bases: object[], tiers: object[], rounds: object[],
 *   gear: { boxes: object[], pyramids: object[], tanks: object[], beacons: object[] },
 * }}
 */
export function planNeonArchitecture(towers, signs = []) {
    const A = NEON_ARCHITECTURE;
    const K = NEON_GEAR_KIND;
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

    /** @type {any[]} */
    const bases = [];
    /** @type {any[]} */
    const tiers = [];
    /** @type {any[]} */
    const rounds = [];
    /** @type {{ boxes: any[], pyramids: any[], tanks: any[], beacons: any[] }} */
    const gear = {
        boxes: [], pyramids: [], tanks: [], beacons: [],
    };
    towers.forEach((tower, index) => {
        // The tower's own generator: adding a tower elsewhere never changes this one.
        const rand = mulberry32(0x41c7 + Math.imul(Math.floor(tower.seed * 1000) + 1, 7919) + (tower.rank * 131) + (tower.bank * 17));
        /** @param {number} a @param {number} b */
        const range = (a, b) => a + (rand() * (b - a));
        /** @param {readonly number[]} odds */
        const pick = (odds) => {
            const roll = rand();
            let acc = 0;
            for (let k = 0; k < odds.length; k += 1) {
                acc += odds[k];
                if (roll <= acc) return k;
            }
            return odds.length - 1;
        };
        let style = pick(A.styleOdds);
        if (tower.hero > 0) style = rand() < 0.6 ? NEON_STYLE.curtain : NEON_STYLE.piers;
        const tint = rand();
        const H = tower.height;
        const look = {
            seed: tower.seed,
            occupancy: tower.occupancy + arrivalLife(tower),
            warmBias: tower.warmBias,
            hero: tower.hero,
            style,
            tint,
        };
        /** @param {{x: number, z: number, width: number, depth: number}} at
         *  @param {number} from @param {number} to @param {number} [kind] one of NEON_PART */
        const part = (at, from, to, kind = NEON_PART.body) => ({
            ...look,
            x: at.x,
            z: at.z,
            width: at.width,
            depth: at.depth,
            height: to - from,
            y: STREET_Y + ((from + to) * 0.5),
            base: from,
            part: kind,
        });
        /** @param {{x: number, z: number, width: number, depth: number}} at @param {number} level */
        const ledge = (at, level) => {
            tiers.push(part({
                x: at.x, z: at.z, width: at.width + (2 * A.ledgeOut), depth: at.depth + (2 * A.ledgeOut),
            }, level - (A.ledgeThick * 0.5), level + (A.ledgeThick * 0.5), NEON_PART.ledge));
        };
        /** @param {{x: number, z: number, width: number, depth: number}} at @param {number} by */
        const inset = (at, by) => ({
            x: at.x, z: at.z, width: at.width - (2 * by), depth: at.depth - (2 * by),
        });

        const footprint = {
            x: tower.x, z: tower.z, width: tower.width, depth: tower.depth,
        };
        const span = Math.min(tower.width, tower.depth);
        const room = H - clear[index];
        const tall = H > 110 || tower.hero > 0;
        const formed = H >= A.setbackMinHeight && room >= A.setbackMinRoom && rand() < (tall ? 0.97 : 0.72);
        /**
         * The roofs that end the tower: each { at, top (above the street), part, round }.
         * @type {{ at: {x: number, z: number, width: number, depth: number}, top: number, part: any, round?: boolean }[]}
         */
        const tops = [];
        let baseTop = H;
        if (formed) {
            let form = tower.hero > 0 ? 0 : pick(A.formOdds);
            if (form === 2 && Math.max(tower.width, tower.depth) < 21) form = 0;
            if (form === 3 && span < 15) form = 1;
            const first = Math.max(clear[index], H * (form === 4 ? range(0.28, 0.42) : range(0.4, 0.6)));
            const rest = H - first;
            if (rest >= 10) {
                baseTop = first;
                ledge(footprint, first);
                if (form === 0) {
                    // Stepped: the tower draws in once, twice or three times, all round.
                    let steps = 1;
                    if (rest > 44 && rand() < 0.4) steps = 3;
                    else if (rest > 24 && rand() < 0.8) steps = 2;
                    let at = inset(footprint, Math.max(1.6, span * range(0.09, 0.16)));
                    let from = first;
                    for (let k = 0; k < steps; k += 1) {
                        const last = k === steps - 1;
                        const to = last ? H : from + ((H - from) * range(0.42, 0.62));
                        const body = part(at, from, to);
                        tiers.push(body);
                        if (last) {
                            tops.push({ at, top: H, part: body });
                            break;
                        }
                        const next = inset(at, Math.max(1.3, Math.min(at.width, at.depth) * range(0.09, 0.15)));
                        if (next.width < 5.5 || next.depth < 5.5) {
                            body.height = H - from;
                            body.y = STREET_Y + ((from + H) * 0.5);
                            tops.push({ at, top: H, part: body });
                            break;
                        }
                        ledge(at, to);
                        at = next;
                        from = to;
                    }
                } else if (form === 1) {
                    // Offset: the shaft stands in a corner of its base, over a terrace on two sides.
                    const cutX = span * range(0.16, 0.32);
                    const cutZ = span * range(0.0, 0.26);
                    const sx = rand() < 0.5 ? -1 : 1;
                    const sz = rand() < 0.5 ? -1 : 1;
                    const at = {
                        x: tower.x + (sx * cutX * 0.5),
                        z: tower.z + (sz * cutZ * 0.5),
                        width: tower.width - cutX,
                        depth: tower.depth - cutZ,
                    };
                    const two = rest > 30 && rand() < 0.6;
                    const mid = two ? first + (rest * range(0.55, 0.75)) : H;
                    const body = part(at, first, mid);
                    tiers.push(body);
                    if (two) {
                        const up = inset(at, Math.max(1.3, Math.min(at.width, at.depth) * range(0.1, 0.16)));
                        ledge(at, mid);
                        const cap = part(up, mid, H);
                        tiers.push(cap);
                        tops.push({ at: up, top: H, part: cap });
                    } else {
                        tops.push({ at, top: H, part: body });
                    }
                } else if (form === 2) {
                    // Twin: two slabs with a slot of sky between them, one a little the taller.
                    const alongX = tower.width >= tower.depth;
                    const long = alongX ? tower.width : tower.depth;
                    const short = alongX ? tower.depth : tower.width;
                    const edge = Math.max(1.2, span * range(0.06, 0.1));
                    const slot = range(2.6, 4.4);
                    const slab = ((long - slot) * 0.5) - edge;
                    const lower = H - range(5, Math.min(18, rest * 0.5));
                    [-1, 1].forEach((sgn, k) => {
                        const off = sgn * ((slot * 0.5) + (slab * 0.5));
                        const at = {
                            x: tower.x + (alongX ? off : 0),
                            z: tower.z + (alongX ? 0 : off),
                            width: alongX ? slab : short - (2 * edge),
                            depth: alongX ? short - (2 * edge) : slab,
                        };
                        const top = k === 0 ? H : lower;
                        const body = part(at, first, top);
                        tiers.push(body);
                        tops.push({ at, top, part: body });
                    });
                } else if (form === 3) {
                    // A drum on the base, a lantern on the drum.
                    const diameter = span - (2 * range(1.4, 2.6));
                    const slide = (Math.max(tower.width, tower.depth) - span) * 0.5 * (rand() < 0.5 ? -1 : 1) * range(0.4, 1);
                    const at = {
                        x: tower.x + (tower.width > tower.depth ? slide : 0),
                        z: tower.z + (tower.width > tower.depth ? 0 : slide),
                        width: diameter,
                        depth: diameter,
                    };
                    const lantern = rest > 22 && rand() < 0.65;
                    const mid = lantern ? H - range(6, 11) : H;
                    const drum = part(at, first, mid, NEON_PART.round);
                    rounds.push(drum);
                    if (lantern) {
                        const up = inset(at, diameter * range(0.14, 0.2));
                        const cap = part(up, mid, H, NEON_PART.round);
                        rounds.push(cap);
                        tops.push({
                            at: up, top: H, part: cap, round: true,
                        });
                    } else {
                        tops.push({
                            at, top: H, part: drum, round: true,
                        });
                    }
                } else {
                    // A slender shaft from a broad base.
                    const keep = range(0.52, 0.66);
                    const at = {
                        x: tower.x + ((tower.width * (1 - keep)) * range(-0.3, 0.3)),
                        z: tower.z + ((tower.depth * (1 - keep)) * range(-0.3, 0.3)),
                        width: tower.width * keep,
                        depth: tower.depth * keep,
                    };
                    const body = part(at, first, H);
                    tiers.push(body);
                    tops.push({ at, top: H, part: body });
                }
            }
        }
        const basePart = {
            ...tower,
            ...look,
            height: baseTop,
            y: STREET_Y + (baseTop * 0.5),
            base: 0,
            part: NEON_PART.body,
            fullHeight: H,
        };
        bases.push(basePart);
        if (!tops.length) tops.push({ at: footprint, top: H, part: basePart });
        tops.forEach((top) => { top.part.part += NEON_PART_TOP; });

        // ── The crown and the roof ──
        const busy = roofBusy[index] === 1;
        const masonryStyle = style === NEON_STYLE.punched || style === NEON_STYLE.piers;
        tops.forEach((roof, roofIndex) => {
            const { at } = roof;
            const roofY = STREET_Y + roof.top;
            const roofSpan = Math.min(at.width, at.depth);
            // A cornice on the masonry styles.
            if (!busy && !roof.round && masonryStyle && rand() < 0.7) ledge(at, roof.top - 0.2);
            if (tall) {
                // A crown: a helipad on a broad flat top, a stepped top, a pyramid cap on the stone
                // towers, a tiara of fins on the glass ones, a mast on most.
                let tip = roofY;
                const crown = rand();
                if (roofIndex === 0 && !roof.round && tower.hero === 0 && roofSpan > 15 && crown < 0.2) {
                    roof.part.part += NEON_PART_PAD;
                    gear.beacons.push({
                        x: at.x + (at.width * 0.42), y: roofY + 1.2, z: at.z + (at.depth * 0.42), phase: rand(), hue: 0,
                    });
                    return;
                }
                /** @type {{x: number, z: number, width: number, depth: number} | null} */
                let stand = at;
                if (!roof.round && crown < 0.5 && roofSpan > 9) {
                    // Stepped: two or three low tiers, each drawn in.
                    const count = rand() < 0.5 ? 3 : 2;
                    let level = roof.top;
                    for (let k = 0; k < count; k += 1) {
                        const next = inset(stand, Math.max(0.9, Math.min(stand.width, stand.depth) * range(0.12, 0.18)));
                        if (next.width < 3 || next.depth < 3) break;
                        stand = next;
                        const rise = range(3.2, 6.5);
                        tiers.push(part(stand, level, level + rise));
                        level += rise;
                    }
                    tip = STREET_Y + level;
                } else if (!roof.round && (style === NEON_STYLE.piers || crown < 0.72)) {
                    const capHeight = roofSpan * range(0.55, 1.0);
                    gear.pyramids.push({
                        x: at.x, y: roofY + (capHeight * 0.5), z: at.z, width: at.width * 0.94, height: capHeight, depth: at.depth * 0.94, tint, hero: tower.hero,
                    });
                    tip += capHeight;
                    stand = null;
                } else if (!roof.round) {
                    // A tiara: fins standing round the top, the tallest at the corners.
                    const fins = Math.max(3, Math.min(7, Math.round(at.width / 3.2)));
                    const rise = range(5, 10);
                    for (let side = -1; side <= 1; side += 2) {
                        for (let k = 0; k < fins; k += 1) {
                            const u = (k / (fins - 1)) - 0.5;
                            const h = rise * (0.55 + (0.9 * Math.abs(u)));
                            gear.boxes.push({
                                x: at.x + (u * (at.width - 0.5)), y: roofY + (h * 0.5), z: at.z + (side * ((at.depth * 0.5) - 0.25)), width: 0.42, height: h, depth: 0.5, tint, kind: K.fin, hero: tower.hero,
                            });
                        }
                    }
                }
                const mx = stand ? stand.x : at.x;
                const mz = stand ? stand.z : at.z;
                if (stand === null || rand() < 0.72) {
                    const mast = range(14, 34);
                    gear.boxes.push({
                        x: mx, y: tip + (mast * 0.5), z: mz, width: 0.8, height: mast, depth: 0.8, tint, kind: K.mast,
                    });
                    // A yard across the mast.
                    if (rand() < 0.6) {
                        gear.boxes.push({
                            x: mx, y: tip + (mast * range(0.45, 0.7)), z: mz, width: range(2.4, 4.2), height: 0.22, depth: 0.22, tint, kind: K.mast,
                        });
                    }
                    tip += mast;
                }
                gear.beacons.push({
                    x: mx, y: tip + 0.6, z: mz, phase: rand(), hue: 0,
                });
                return;
            }
            if (busy) return;
            if (!roof.round && rand() < 0.62 && roofSpan > 12) {
                // The plant room: a penthouse off-centre, with a few windows of its own.
                const pw = at.width * range(0.32, 0.56);
                const pd = at.depth * range(0.32, 0.56);
                const px = at.x + ((at.width - pw) * range(-0.3, 0.3));
                const pz = at.z + ((at.depth - pd) * range(-0.3, 0.3));
                tiers.push(part({
                    x: px, z: pz, width: pw, depth: pd,
                }, roof.top, roof.top + range(3.4, 7.5)));
            }
            if (masonryStyle && rand() < 0.42 && roofSpan > 13) {
                // A water tank on legs.
                const r = range(2.0, 3.1);
                const tx = at.x + (at.width * range(-0.28, 0.28));
                const tz = at.z + (at.depth * range(-0.28, 0.28));
                const legs = range(2.2, 3.6);
                const body = range(3.6, 5.2);
                gear.tanks.push({
                    x: tx, y: roofY + legs + (body * 0.5), z: tz, width: r * 2, height: body, depth: r * 2, tint,
                });
                [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
                    gear.boxes.push({
                        x: tx + (sx * r * 0.62), y: roofY + (legs * 0.5), z: tz + (sz * r * 0.62), width: 0.34, height: legs, depth: 0.34, tint, kind: K.leg,
                    });
                });
            }
            // Air handlers, and a run of duct between two of them.
            const units = Math.floor(rand() * 3.6);
            /** @type {any} */
            let previous = null;
            for (let k = 0; k < units; k += 1) {
                const w = range(2.2, 4.4);
                const d = range(2.0, 3.6);
                const h = range(1.3, 2.4);
                const unit = {
                    x: at.x + (at.width * range(-0.34, 0.34)),
                    y: roofY + (h * 0.5),
                    z: at.z + (at.depth * range(-0.34, 0.34)),
                    width: w,
                    height: h,
                    depth: d,
                    tint,
                    kind: K.unit,
                };
                gear.boxes.push(unit);
                if (previous && rand() < 0.7) {
                    // An elbowed duct: along x from the last unit, then along z to this one.
                    const y = roofY + 0.4;
                    const lx = Math.abs(unit.x - previous.x);
                    const lz = Math.abs(unit.z - previous.z);
                    if (lx > 1.2) {
                        gear.boxes.push({
                            x: (unit.x + previous.x) * 0.5, y, z: previous.z, width: lx, height: 0.7, depth: 0.8, tint, kind: K.duct,
                        });
                    }
                    if (lz > 1.2) {
                        gear.boxes.push({
                            x: unit.x, y, z: (unit.z + previous.z) * 0.5, width: 0.8, height: 0.7, depth: lz, tint, kind: K.duct,
                        });
                    }
                }
                previous = unit;
            }
            if (rand() < 0.18) {
                // An aerial with a light on it.
                const mast = range(8, 17);
                const mx = at.x + (at.width * range(-0.3, 0.3));
                const mz = at.z + (at.depth * range(-0.3, 0.3));
                gear.boxes.push({
                    x: mx, y: roofY + (mast * 0.5), z: mz, width: 0.5, height: mast, depth: 0.5, tint, kind: K.mast,
                });
                gear.beacons.push({
                    x: mx, y: roofY + mast + 0.4, z: mz, phase: rand(), hue: rand() < 0.3 ? 1 : 0,
                });
            }
        });
    });
    return {
        bases, tiers, rounds, gear,
    };
}

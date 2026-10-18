/**
 * High Coast — the renderer-free core: small maths, the view rig, the landmarks, the rising land's
 * arithmetic and the piece codes.
 *
 * The look is still being tuned, so nothing here pins a lift in metres, a lens or a landmark's
 * place: the tests hold the relations the world is built on (a bigger clear lifts more, the lift
 * never passes its ceiling, the pine stands left of the card) and read every number from the core.
 */
import { describe, expect, it } from 'vitest';
import {
    DEG, EYE, FIELDS, FIELD_BLEND, FIELD_ORDER, PIECE_CODE, PIECE_COLORS, PIECE_ORDER, PLACES, RIG, SHAPES, SHAPE_KEYS,
    TIMING, UPLIFT, approach, bearingOf, cellsFromMatrix, clamp, clampInt, hexToLinear, lerp, liftAfter, mulberry32,
    PINE_FRAME, frameYaw, pieceCode, relaxLift, rigFor, smooth, upliftStep,
} from '../../src/themes/high-coast/high-coast-core.js';
import { HIGH_COAST_TETROMINOS } from '../../src/themes/high-coast/high-coast-tetrominos.js';

/** Hue of an sRGB hex colour in degrees [0, 360). */
function hueOf(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const hi = Math.max(r, g, b);
    const d = hi - Math.min(r, g, b);
    if (!d) return 0;
    let h;
    if (hi === r) h = ((g - b) / d) % 6;
    else if (hi === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return (h * 60 + 360) % 360;
}

/** The conventional hue band of each shape (degrees; Z's wraps through red). */
const CONVENTIONAL_BANDS = Object.freeze({
    I: [[160, 210]],
    O: [[32, 75]],
    T: [[245, 315]],
    S: [[90, 170]],
    Z: [[320, 360], [0, 20]],
    J: [[200, 250]],
    L: [[20, 50]],
});

describe('High Coast maths', () => {
    it('clamps, steps and eases as the shaders do', () => {
        expect(clamp(5, 0, 1)).toBe(1);
        expect(clamp(-5, 0, 1)).toBe(0);
        expect(clamp(Number.NaN, 2, 3)).toBe(2);
        expect(clampInt(2.6, 0, 10)).toBe(3);
        expect(lerp(2, 4, 0.25)).toBe(2.5);
        expect(smooth(0, 1, -1)).toBe(0);
        expect(smooth(0, 1, 2)).toBe(1);
        expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5, 12);
        // Equal edges are a step, never a division by zero.
        expect(smooth(3, 3, 2.9)).toBe(0);
        expect(smooth(3, 3, 3)).toBe(1);
    });

    it('approaches a target at a rate independent of how the time is sliced', () => {
        expect(approach(2, 0)).toBe(0);
        expect(approach(2, 1e6)).toBeCloseTo(1, 12);
        const once = approach(1.5, 0.2);
        const twice = 1 - (1 - approach(1.5, 0.1)) ** 2;
        expect(twice).toBeCloseTo(once, 12);
    });

    it('draws the same deterministic sequence for a seed, in [0, 1)', () => {
        const seqA = Array.from({ length: 200 }, mulberry32(42));
        expect(Array.from({ length: 200 }, mulberry32(42))).toEqual(seqA);
        expect(Array.from({ length: 200 }, mulberry32(43))).not.toEqual(seqA);
        seqA.forEach((v) => {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        });
    });

    it('reads sRGB hex as linear light and anything else as black', () => {
        expect(hexToLinear('#FFFFFF')).toEqual([1, 1, 1]);
        expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
        expect(hexToLinear('808080')[0]).toBeCloseTo(0.2158605, 6);
        expect(hexToLinear('nonsense')).toEqual([0, 0, 0]);
        expect(hexToLinear(null)).toEqual([0, 0, 0]);
        const out = [9, 9, 9];
        expect(hexToLinear('#ff0000', out)).toBe(out);
        expect(out).toEqual([1, 0, 0]);
    });
});

describe('High Coast view', () => {
    it('chooses the lens by aspect: portrait, landscape and wide', () => {
        expect(rigFor(9 / 19.5)).toBe(RIG.portrait);
        expect(rigFor(0.5)).toBe(RIG.portrait);
        expect(rigFor(0.75)).toBe(RIG.landscape);
        expect(rigFor(4 / 3)).toBe(RIG.landscape);
        expect(rigFor(16 / 9)).toBe(RIG.landscape);
        expect(rigFor(2.1)).toBe(RIG.landscape);
        expect(rigFor(21 / 9)).toBe(RIG.wide);
        expect(rigFor(32 / 9)).toBe(RIG.wide);
        for (const nonsense of [Number.NaN, 0, -1, undefined, Infinity]) expect(rigFor(nonsense)).toBe(RIG.landscape);
    });

    it('never cuts the old pine\'s crown off its trunk at the left edge', () => {
        const edgeAt = (aspect) => {
            const rig = rigFor(aspect);
            const half = Math.atan(Math.tan((rig.fov * DEG) / 2) * aspect) / DEG;
            return frameYaw(rig, aspect) - half;
        };
        for (const aspect of [9 / 21, 9 / 19.5, 0.5, 0.6, 0.7, 0.749, 0.75, 0.9, 1, 1.2, 4 / 3, 1.6, 16 / 9, 2.1, 21 / 9, 32 / 9]) {
            const edge = edgeAt(aspect);
            const holdsTrunk = edge <= PINE_FRAME.trunk - PINE_FRAME.margin + 1e-9;
            const clearsCrown = edge >= PINE_FRAME.crown + PINE_FRAME.margin - 1e-9;
            expect(holdsTrunk || clearsCrown).toBe(true);
        }
        // Wide lenses keep their rest yaw; portrait faces the sun and clears the crown.
        expect(frameYaw(RIG.landscape, 16 / 9)).toBe(RIG.landscape.yaw);
        expect(frameYaw(RIG.wide, 21 / 9)).toBe(RIG.wide.yaw);
        expect(edgeAt(9 / 19.5)).toBeGreaterThanOrEqual(PINE_FRAME.crown + PINE_FRAME.margin - 1e-9);
        expect(Number.isFinite(frameYaw(RIG.landscape, Number.NaN))).toBe(true);
    });

    it('looks down across the bay, wider in portrait, narrower on a wide screen', () => {
        for (const key of ['portrait', 'landscape', 'wide']) {
            expect(RIG[key].pitch, key).toBeLessThanOrEqual(0); // never up into the sky
            expect(RIG[key].fov, key).toBeGreaterThan(10);
            expect(RIG[key].fov, key).toBeLessThan(90);
        }
        expect(RIG.landscape.pitch).toBeLessThan(0);
        expect(RIG.wide.pitch).toBeLessThan(0);
        // Portrait brings the bay down below the card: by pitching further down, or by a lens shift.
        const shift = RIG.portrait.shift ?? 0;
        expect(Number.isFinite(shift) && shift >= 0 && shift < 2).toBe(true);
        expect(RIG.portrait.pitch < RIG.landscape.pitch || shift > 0).toBe(true);
        expect(RIG.portrait.fov).toBeGreaterThan(RIG.landscape.fov);
        expect(RIG.wide.fov).toBeLessThan(RIG.landscape.fov);
        expect(RIG.near).toBeGreaterThan(0);
        // The outer archipelago and the far coast stand tens of kilometres out.
        expect(RIG.far).toBeGreaterThan(FIELDS.far.span);
    });

    it('nests the three fields around the eye with room for each blend band', () => {
        expect(FIELD_ORDER).toEqual(['near', 'mid', 'far']);
        const edges = (f) => ({
            x0: f.x0, x1: f.x0 + f.span, z0: f.z0, z1: f.z0 + f.span,
        });
        FIELD_ORDER.forEach((name) => {
            const f = FIELDS[name];
            expect(f.name).toBe(name);
            expect(f.hi).toBeGreaterThan(f.lo);
            // The sea floor is part of the land: every field reaches below the sea at rest.
            expect(f.lo, name).toBeLessThan(0);
            expect(Number.isInteger(f.size) && f.size > 64).toBe(true);
            const e = edges(f);
            expect(EYE.x > e.x0 && EYE.x < e.x1 && EYE.z > e.z0 && EYE.z < e.z1, `${name} holds the eye`).toBe(true);
        });
        for (const [inner, outer] of [['near', 'mid'], ['mid', 'far']]) {
            const a = edges(FIELDS[inner]);
            const b = edges(FIELDS[outer]);
            const gap = Math.min(a.x0 - b.x0, b.x1 - a.x1, a.z0 - b.z0, b.z1 - a.z1);
            expect(gap, `${inner} inside ${outer}`).toBeGreaterThan(FIELD_BLEND[inner]);
            expect(FIELD_BLEND[inner]).toBeGreaterThan(0);
            const post = (name) => FIELDS[name].span / (FIELDS[name].size - 1);
            expect(post(inner)).toBeLessThan(post(outer));
        }
        expect(EYE.y).toBeGreaterThan(FIELDS.near.lo);
        expect(EYE.y).toBeLessThan(FIELDS.near.hi);
    });
});

describe('High Coast landmarks', () => {
    it('measures bearings right of the view axis (the view looks down −z)', () => {
        expect(bearingOf(EYE.x, EYE.z - 100).bearing).toBeCloseTo(0, 9);
        expect(bearingOf(EYE.x + 100, EYE.z - 100).bearing).toBeCloseTo(45, 9);
        expect(bearingOf(EYE.x - 100, EYE.z - 100).bearing).toBeCloseTo(-45, 9);
        expect(bearingOf(EYE.x + 30, EYE.z - 40).distance).toBeCloseTo(50, 9);
    });

    it('stands the old pine and the trail sign left of the card, the hamlet right of it', () => {
        for (const name of ['pine', 'sign']) {
            const { bearing } = bearingOf(PLACES[name].x, PLACES[name].z);
            expect(bearing, name).toBeGreaterThan(-33);
            expect(bearing, name).toBeLessThan(-9);
        }
        const hamlet = bearingOf(PLACES.hamlet.x, PLACES.hamlet.z).bearing;
        expect(hamlet).toBeGreaterThan(9);
        expect(hamlet).toBeLessThan(33);
        // The pine and the sign stand on the summit a stone's throw away; the sign nearer.
        const away = (name) => bearingOf(PLACES[name].x, PLACES[name].z).distance;
        expect(away('sign')).toBeLessThan(away('pine'));
        expect(away('pine')).toBeLessThan(40);
        // The cliff and the lighthouse lie out in front of the eye, the lighthouse beyond the hamlet.
        for (const name of ['cliff', 'hamlet', 'lighthouse']) expect(PLACES[name].z, name).toBeLessThan(EYE.z);
        expect(bearingOf(PLACES.cliff.x, PLACES.cliff.z).bearing).toBeLessThan(0);
        expect(bearingOf(PLACES.lighthouse.x, PLACES.lighthouse.z).distance)
            .toBeGreaterThan(bearingOf(PLACES.hamlet.x, PLACES.hamlet.z).distance);
    });
});

describe('High Coast rising land', () => {
    it('lifts more for more lines, at any chain length', () => {
        for (let chain = 1; chain <= UPLIFT.chainCap + 3; chain++) {
            for (let lines = 1; lines < 4; lines++) {
                expect(upliftStep(lines + 1, chain), `${lines + 1} vs ${lines} lines, chain ${chain}`)
                    .toBeGreaterThan(upliftStep(lines, chain));
            }
            expect(upliftStep(1, chain)).toBeGreaterThan(0);
        }
    });

    it('lifts more for each link of a chain, up to the chain cap and no further', () => {
        for (let lines = 1; lines <= 4; lines++) {
            for (let chain = 1; chain <= UPLIFT.chainCap; chain++) {
                expect(upliftStep(lines, chain + 1), `${lines} lines, chain ${chain + 1}`)
                    .toBeGreaterThan(upliftStep(lines, chain));
            }
            const capped = upliftStep(lines, UPLIFT.chainCap + 1);
            for (const chain of [UPLIFT.chainCap + 2, UPLIFT.chainCap + 10, 1000]) {
                expect(upliftStep(lines, chain), `${lines} lines, chain ${chain}`).toBe(capped);
            }
            // No chain (0, nonsense) is the same as a chain of one.
            expect(upliftStep(lines, 0)).toBe(upliftStep(lines, 1));
            expect(upliftStep(lines)).toBe(upliftStep(lines, 1));
        }
        // Lines are read as 1..4 whatever is passed.
        expect(upliftStep(9, 1)).toBe(upliftStep(4, 1));
        expect(upliftStep(0, 1)).toBe(upliftStep(1, 1));
    });

    it('adds the great rebound on four lines: more than three lines and one line together, by the bonus', () => {
        expect(UPLIFT.quadBonus).toBeGreaterThan(0);
        for (let chain = 1; chain <= UPLIFT.chainCap + 1; chain++) {
            const quad = upliftStep(4, chain);
            const parts = upliftStep(3, chain) + upliftStep(1, chain);
            expect(quad - parts, `chain ${chain}`).toBeCloseTo(UPLIFT.quadBonus, 9);
            // Lines below four add up linearly (no bonus).
            expect(upliftStep(3, chain)).toBeCloseTo(upliftStep(2, chain) + upliftStep(1, chain), 9);
        }
    });

    it('never lets the asked lift pass the ceiling, and never lowers it', () => {
        const random = mulberry32(7);
        for (let i = 0; i < 2000; i++) {
            const ask = random() * UPLIFT.ceiling * 1.2 - UPLIFT.ceiling * 0.1;
            const step = random() * 3 * upliftStep(4, UPLIFT.chainCap + 1);
            const after = liftAfter(ask, step);
            expect(after, `${ask} + ${step}`).toBeLessThanOrEqual(UPLIFT.ceiling);
            expect(after, `${ask} + ${step}`).toBeGreaterThanOrEqual(clamp(ask, 0, UPLIFT.ceiling) - 1e-12);
        }
        // A run of the biggest clears climbs to the ceiling and stays there.
        let ask = 0;
        for (let i = 0; i < 50; i++) ask = liftAfter(ask, upliftStep(4, UPLIFT.chainCap + 1));
        expect(ask).toBeLessThanOrEqual(UPLIFT.ceiling);
        expect(ask).toBeGreaterThan(UPLIFT.ceiling * 0.99);
        // A negative step lifts nothing.
        expect(liftAfter(5, -3)).toBe(5);
    });

    it('gives each step less as the lift nears its ceiling', () => {
        for (const step of [upliftStep(1, 1), upliftStep(2, 3), upliftStep(3, 1)]) {
            let previous = Infinity;
            for (let ask = 0; ask < UPLIFT.ceiling; ask += UPLIFT.ceiling / 20) {
                const gain = liftAfter(ask, step) - ask;
                expect(gain, `step ${step} at ${ask}`).toBeLessThan(previous);
                expect(gain).toBeGreaterThanOrEqual(0);
                previous = gain;
            }
            expect(liftAfter(UPLIFT.ceiling, step)).toBe(UPLIFT.ceiling);
        }
    });

    it('lets the sea return: the ask decays with time, faster for a shorter time constant', () => {
        const ask = 20;
        expect(relaxLift(ask, 0)).toBe(ask);
        let previous = ask;
        for (let dt = 1; dt <= 300; dt += 1) {
            const left = relaxLift(ask, dt);
            expect(left, `dt ${dt}`).toBeLessThan(previous);
            expect(left).toBeGreaterThan(0);
            previous = left;
        }
        expect(relaxLift(ask, UPLIFT.relax)).toBeCloseTo(ask / Math.E, 9);
        // Slicing the time changes nothing (the frame rate cannot speed the sea up).
        expect(relaxLift(relaxLift(ask, 3), 4)).toBeCloseTo(relaxLift(ask, 7), 9);
        // A released chain's swell returns the sea faster than the rest.
        expect(UPLIFT.release).toBeLessThan(UPLIFT.relax);
        for (const dt of [1, 5, 20]) {
            expect(relaxLift(ask, dt, UPLIFT.release)).toBeLessThan(relaxLift(ask, dt, UPLIFT.relax));
            for (const tau of [2, 10, 40]) expect(relaxLift(ask, dt, tau)).toBeLessThan(relaxLift(ask, dt, tau * 2));
        }
        // Nothing is asked below the sea at rest, and time never runs backward.
        expect(relaxLift(-4, 10)).toBe(0);
        expect(relaxLift(ask, -10)).toBe(ask);
        expect(Number.isFinite(relaxLift(ask, 1, 0))).toBe(true);
    });
});

describe('High Coast pieces', () => {
    it('numbers the pieces in one order and colours them as the board does', () => {
        expect(PIECE_ORDER).toEqual(['I', 'T', 'Z', 'L', 'S', 'J', 'O', 'GARBAGE']);
        expect(PIECE_COLORS).toHaveLength(PIECE_ORDER.length);
        PIECE_ORDER.forEach((key, code) => {
            expect(PIECE_CODE[key]).toBe(code);
            expect(PIECE_COLORS[code]).toMatch(/^#[0-9a-f]{6}$/i);
            expect(PIECE_COLORS[code].toLowerCase(), key).toBe(HIGH_COAST_TETROMINOS.colors[key].toLowerCase());
        });
    });

    it('keeps every shape out of its conventional hue band (0 of 7)', () => {
        const colourOf = (key) => PIECE_COLORS[PIECE_CODE[key]];
        const inBand = SHAPE_KEYS.filter((key) => {
            const hue = hueOf(colourOf(key));
            return CONVENTIONAL_BANDS[key].some(([lo, hi]) => hue >= lo && hue <= hi);
        }).map((key) => `${key} ${colourOf(key)} (${hueOf(colourOf(key)).toFixed(1)}°)`);
        expect(inBand).toEqual([]);
        // The gate itself sees a conventional colour.
        expect(hueOf('#00FFFF')).toBeCloseTo(180, 9);
        expect(hueOf('#FF0000')).toBe(0);
        expect(Object.keys(CONVENTIONAL_BANDS).sort()).toEqual([...SHAPE_KEYS].sort());
    });

    it('reads a shape key however it is spelt and treats anything else as garbage', () => {
        expect(pieceCode('T')).toBe(PIECE_CODE.T);
        expect(pieceCode(' s ')).toBe(PIECE_CODE.S);
        expect(pieceCode('garbage')).toBe(PIECE_CODE.GARBAGE);
        for (const other of ['X', '', 'toString', '__proto__', null, undefined, 5, {}]) {
            expect(pieceCode(other), String(other)).toBe(PIECE_CODE.GARBAGE);
        }
    });

    it('turns every spawn matrix into four cells centred on their box', () => {
        expect([...SHAPE_KEYS].sort()).toEqual(['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
        expect(cellsFromMatrix(SHAPES.I)).toEqual([-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0]);
        expect(cellsFromMatrix(SHAPES.O)).toEqual([-0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5]);
        for (const key of SHAPE_KEYS) {
            const cells = cellsFromMatrix(SHAPES[key]);
            expect(cells, key).toHaveLength(8);
            const xs = cells.filter((_, i) => i % 2 === 0);
            const ys = cells.filter((_, i) => i % 2 === 1);
            expect(Math.max(...xs) + Math.min(...xs), key).toBeCloseTo(0, 12);
            expect(Math.max(...ys) + Math.min(...ys), key).toBeCloseTo(0, 12);
            expect(new Set(xs.map((x, i) => `${x},${ys[i]}`)).size, key).toBe(4);
        }
        // y runs up: the T's stem is above its bar.
        const t = cellsFromMatrix(SHAPES.T);
        expect(t[1]).toBeGreaterThan(t[3]);
    });

    it('refuses what is not a matrix, and pads a short one', () => {
        for (const bad of [null, 'I', [], [[0, 0], [0, 0]], [null, 'row']]) expect(cellsFromMatrix(bad)).toBeNull();
        expect(cellsFromMatrix([[1]])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(cellsFromMatrix([[1, 1, 1, 1, 1, 1]])).toHaveLength(8);
        expect(cellsFromMatrix([['1', 0], [0, true]])).toEqual([-0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5]);
    });
});

describe('High Coast timings', () => {
    it('keeps every timing positive and the hour wheel on the house rule', () => {
        Object.entries(TIMING).forEach(([key, value]) => {
            expect(Number.isFinite(value) && value > 0, key).toBe(true);
        });
        // One station of the day to the next per 80–120 s of clock, never resting on one.
        expect(TIMING).not.toHaveProperty('hourRest');
        expect(TIMING.hour).toBeGreaterThanOrEqual(80);
        expect(TIMING.hour).toBeLessThanOrEqual(120);
        expect(TIMING.levelTurn).toBeLessThan(TIMING.hour);
        // The sea returns more slowly than the chain's swell runs in.
        expect(UPLIFT.relax).toBeGreaterThan(TIMING.swell);
    });
});

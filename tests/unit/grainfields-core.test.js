/**
 * Grainfields — the renderer-free core: small maths, the view rig, the landmarks, the piece codes
 * and the timings.
 *
 * The look is still being tuned, so nothing here pins a lens or a landmark's place in metres: the
 * tests hold the relations the world is built on (the gate stands left of the card in every frame,
 * the herd grazes right of it inside the crest, the fort beyond it) and read every number from the
 * core. The model is tests/unit/high-coast-core.test.js.
 */
import { describe, expect, it } from 'vitest';
import {
    CREST, DECK, DEG, EYE, PIECE_CODE, PIECE_COLORS, PIECE_ORDER, PLACES, RIG, SHAPES, SHAPE_KEYS, TAU, TIMING,
    approach, bearingOf, cellsFromMatrix, clamp, clamp01, clampInt, hexToLinear, lerp, mulberry32, pieceCode,
    pointAt, rigFor, smooth,
} from '../../src/themes/grainfields/grainfields-core.js';
import { GRAINFIELDS_TETROMINOS } from '../../src/themes/grainfields/grainfields-tetrominos.js';

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

/** Every aspect a screen may have, from a tall phone to 32:9. */
const ASPECTS = [9 / 21, 9 / 19.5, 0.5, 0.6, 0.7, 0.749, 0.75, 0.9, 1, 1.2, 4 / 3, 1.6, 16 / 9, 2.1, 2.11, 21 / 9, 32 / 9];

/** The frame's left and right edges (bearings, degrees) for an aspect at the rig's rest yaw. */
function frameEdges(aspect) {
    const rig = rigFor(aspect);
    const half = Math.atan(Math.tan((rig.fov * DEG) / 2) * aspect) / DEG;
    return { left: rig.yaw - half, right: rig.yaw + half, centre: rig.yaw };
}

describe('Grainfields maths', () => {
    it('clamps, steps and eases as the shaders do', () => {
        expect(clamp(5, 0, 1)).toBe(1);
        expect(clamp(-5, 0, 1)).toBe(0);
        expect(clamp(Number.NaN, 2, 3)).toBe(2);
        expect(clamp(Infinity, 2, 3)).toBe(2);
        expect(clamp01(1.5)).toBe(1);
        expect(clamp01(-0.5)).toBe(0);
        expect(clamp01(0.25)).toBe(0.25);
        expect(clampInt(2.6, 0, 10)).toBe(3);
        expect(clampInt(12, 0, 10)).toBe(10);
        expect(lerp(2, 4, 0.25)).toBe(2.5);
        expect(smooth(0, 1, -1)).toBe(0);
        expect(smooth(0, 1, 2)).toBe(1);
        expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5, 12);
        // Equal edges are a step, never a division by zero.
        expect(smooth(3, 3, 2.9)).toBe(0);
        expect(smooth(3, 3, 3)).toBe(1);
        expect(TAU).toBeCloseTo(2 * Math.PI, 15);
        expect(DEG * 180).toBeCloseTo(Math.PI, 15);
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
        expect(hexToLinear(' #ff0000 ')).toEqual([1, 0, 0]);
        expect(hexToLinear('nonsense')).toEqual([0, 0, 0]);
        expect(hexToLinear('#fff')).toEqual([0, 0, 0]);
        expect(hexToLinear(null)).toEqual([0, 0, 0]);
        const out = [9, 9, 9];
        expect(hexToLinear('#ff0000', out)).toBe(out);
        expect(out).toEqual([1, 0, 0]);
        expect(hexToLinear('bad', out)).toBe(out);
        expect(out).toEqual([0, 0, 0]);
    });
});

describe('Grainfields view', () => {
    it('chooses the lens by aspect: portrait, near-square, landscape and wide', () => {
        expect(rigFor(9 / 19.5)).toBe(RIG.portrait);
        expect(rigFor(0.5)).toBe(RIG.portrait);
        expect(rigFor(0.749)).toBe(RIG.portrait);
        expect(rigFor(0.75)).toBe(RIG.square);
        expect(rigFor(1)).toBe(RIG.square);
        expect(rigFor(1.249)).toBe(RIG.square);
        expect(rigFor(4 / 3)).toBe(RIG.landscape);
        expect(rigFor(16 / 9)).toBe(RIG.landscape);
        expect(rigFor(2.1)).toBe(RIG.landscape);
        expect(rigFor(21 / 9)).toBe(RIG.wide);
        expect(rigFor(32 / 9)).toBe(RIG.wide);
        for (const nonsense of [Number.NaN, 0, -1, undefined, Infinity, '16/9']) expect(rigFor(nonsense)).toBe(RIG.landscape);
    });

    it('looks out level and a touch up (never down into the barley), wider in portrait, narrower on a wide screen', () => {
        for (const key of ['portrait', 'square', 'landscape', 'wide']) {
            expect(RIG[key].pitch, key).toBeGreaterThanOrEqual(0);
            expect(RIG[key].pitch, key).toBeLessThan(15);
            expect(RIG[key].fov, key).toBeGreaterThan(10);
            expect(RIG[key].fov, key).toBeLessThan(90);
            expect(Number.isFinite(RIG[key].yaw), key).toBe(true);
        }
        expect(RIG.portrait.fov).toBeGreaterThan(RIG.landscape.fov);
        expect(RIG.wide.fov).toBeLessThan(RIG.landscape.fov);
        // Portrait looks up and turns left toward the gate, its lens shifted to keep the summit and
        // the sun's gap in the strip above the card.
        expect(RIG.portrait.pitch).toBeGreaterThan(RIG.landscape.pitch);
        expect(RIG.portrait.yaw).toBeLessThan(RIG.landscape.yaw);
        const shift = RIG.portrait.shift ?? 0;
        expect(shift > 0 && shift < 2).toBe(true);
        expect(RIG.landscape.shift ?? 0).toBe(0);
        expect(RIG.wide.shift ?? 0).toBe(0);
        expect(RIG.near).toBeGreaterThan(0);
        // Lapporten stands twelve kilometres out and the deck's far edge tens of kilometres: the far
        // plane holds them all.
        expect(RIG.far).toBeGreaterThan(bearingOf(PLACES.gate.x, PLACES.gate.z).distance * 2);
        expect(RIG.far).toBeGreaterThan(62000);
    });

    // Between 3:4 and 5:4 the near-square lens (54° tall, turned toward the gate) holds it: the
    // landscape lens there was only 34–40° wide and lost the gate past its left edge.
    it('keeps Lapporten in the frame, left of the card, in portrait and from a square screen to 32:9', () => {
        const gate = bearingOf(PLACES.gate.x, PLACES.gate.z).bearing;
        for (const aspect of ASPECTS) {
            const { left, right, centre } = frameEdges(aspect);
            expect(right).toBeGreaterThan(left);
            expect(gate, `aspect ${aspect.toFixed(3)}: left of the centre ${centre}`).toBeLessThan(centre);
            expect(gate, `aspect ${aspect.toFixed(3)}: inside the left edge ${left.toFixed(1)}`).toBeGreaterThan(left + 2);
        }
    });

    it('stands the eye in the barley a man\'s height over the field, the crest at the eye\'s own height', () => {
        const height = EYE.y - EYE.ground;
        expect(height).toBeGreaterThan(1.2);
        expect(height).toBeLessThan(2);
        // The crest's ground rises toward the eye's height (its ears reach it), and never far past.
        expect(CREST.rise).toBeGreaterThan(0);
        expect(EYE.ground + CREST.rise).toBeLessThan(EYE.y);
        expect(EYE.ground + CREST.rise + 1).toBeGreaterThan(EYE.y);
        // About a hundred metres out, swaying with the bearing but never onto the eye.
        expect(CREST.distance).toBeGreaterThan(50);
        expect(CREST.distance).toBeLessThan(200);
        expect(CREST.sway).toBeGreaterThan(0);
        expect(CREST.sway).toBeLessThan(CREST.distance / 2);
        expect(CREST.behind).toBeGreaterThan(1);
    });
});

describe('Grainfields landmarks', () => {
    it('measures bearings right of the view axis (the view looks down −z)', () => {
        expect(bearingOf(EYE.x, EYE.z - 100).bearing).toBeCloseTo(0, 9);
        expect(bearingOf(EYE.x + 100, EYE.z - 100).bearing).toBeCloseTo(45, 9);
        expect(bearingOf(EYE.x - 100, EYE.z - 100).bearing).toBeCloseTo(-45, 9);
        expect(bearingOf(EYE.x + 30, EYE.z - 40).distance).toBeCloseTo(50, 9);
        expect(Math.abs(bearingOf(EYE.x, EYE.z + 10).bearing)).toBeCloseTo(180, 9);
    });

    it('puts a point at a bearing and distance, the inverse of bearingOf', () => {
        const out = [0, 0];
        expect(pointAt(0, 100, out)).toBe(out);
        expect(out[0]).toBeCloseTo(EYE.x, 9);
        expect(out[1]).toBeCloseTo(EYE.z - 100, 9);
        const random = mulberry32(5);
        for (let i = 0; i < 200; i++) {
            const bearing = random() * 340 - 170;
            const distance = 1 + random() * 20000;
            const [x, z] = pointAt(bearing, distance);
            const back = bearingOf(x, z);
            expect(back.bearing).toBeCloseTo(bearing, 6);
            expect(back.distance).toBeCloseTo(distance, 6);
        }
    });

    it('stands Lapporten far out left of the card, the fort beyond the crest, the herd right of the card inside it', () => {
        const gate = bearingOf(PLACES.gate.x, PLACES.gate.z);
        expect(gate.bearing).toBeLessThan(-9);
        expect(gate.bearing).toBeGreaterThan(-33);
        expect(gate.distance).toBeGreaterThan(5000);
        const fort = bearingOf(PLACES.fort.x, PLACES.fort.z);
        expect(fort.bearing).toBeLessThan(0);
        expect(fort.distance).toBeGreaterThan((CREST.distance + CREST.sway) * CREST.behind);
        expect(fort.distance).toBeLessThan(gate.distance);
        expect(PLACES.fort.height).toBeGreaterThan(0);
        expect(PLACES.fort.radius).toBeGreaterThan(0);
        const herd = bearingOf(PLACES.herd.x, PLACES.herd.z);
        expect(herd.bearing).toBeGreaterThan(9);
        expect(herd.bearing).toBeLessThan(40);
        expect(herd.distance + PLACES.herd.radius).toBeLessThan(CREST.distance - CREST.sway);
        // Everything stands in front of the eye.
        for (const name of ['gate', 'fort', 'herd']) expect(PLACES[name].z, name).toBeLessThan(EYE.z);
    });

    it('hangs the storm deck high over everything, its top above its base', () => {
        expect(DECK.base).toBeGreaterThan(1000);
        expect(DECK.top).toBeGreaterThan(DECK.base);
    });
});

describe('Grainfields pieces', () => {
    it('numbers the pieces in one order and colours them as the board does', () => {
        expect(PIECE_ORDER).toEqual(['I', 'T', 'Z', 'L', 'S', 'J', 'O', 'GARBAGE']);
        expect(PIECE_COLORS).toHaveLength(PIECE_ORDER.length);
        PIECE_ORDER.forEach((key, code) => {
            expect(PIECE_CODE[key]).toBe(code);
            expect(PIECE_COLORS[code]).toMatch(/^#[0-9a-f]{6}$/i);
            expect(PIECE_COLORS[code].toLowerCase(), key).toBe(GRAINFIELDS_TETROMINOS.colors[key].toLowerCase());
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
        for (const other of ['X', '', 'toString', '__proto__', 'constructor', null, undefined, 5, {}]) {
            expect(pieceCode(other), String(other)).toBe(PIECE_CODE.GARBAGE);
        }
    });

    it('turns every spawn matrix into four cells centred on their box', () => {
        expect([...SHAPE_KEYS].sort()).toEqual(['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
        // (+ 0 folds a −0 into 0: the cells' y is −row.)
        const plain = (cells) => cells.map((v) => v + 0);
        expect(plain(cellsFromMatrix(SHAPES.I))).toEqual([-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0]);
        expect(plain(cellsFromMatrix(SHAPES.O))).toEqual([-0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5]);
        for (const key of SHAPE_KEYS) {
            const cells = cellsFromMatrix(SHAPES[key]);
            expect(cells, key).toHaveLength(8);
            const xs = cells.filter((_, i) => i % 2 === 0);
            const ys = cells.filter((_, i) => i % 2 === 1);
            expect(Math.max(...xs) + Math.min(...xs), key).toBeCloseTo(0, 12);
            expect(Math.max(...ys) + Math.min(...ys), key).toBeCloseTo(0, 12);
            expect(new Set(xs.map((x, i) => `${x + 0},${ys[i] + 0}`)).size, key).toBe(4);
        }
        // y runs up: the T's stem is above its bar.
        const t = cellsFromMatrix(SHAPES.T);
        expect(t[1]).toBeGreaterThan(t[3]);
    });

    it('refuses what is not a matrix, and pads a short one', () => {
        for (const bad of [null, 'I', [], [[0, 0], [0, 0]], [null, 'row']]) expect(cellsFromMatrix(bad)).toBeNull();
        expect(cellsFromMatrix([[1]]).map((v) => v + 0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(cellsFromMatrix([[1, 1, 1, 1, 1, 1]])).toHaveLength(8);
        expect(cellsFromMatrix([['1', 0], [0, true]])).toEqual([-0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5]);
    });
});

describe('Grainfields timings', () => {
    it('keeps every timing positive and the hour wheel on the house rule', () => {
        Object.entries(TIMING).forEach(([key, value]) => {
            expect(Number.isFinite(value) && value > 0, key).toBe(true);
        });
        // One station of the day to the next per 80–120 s of clock, never resting on one.
        expect(TIMING).not.toHaveProperty('hourRest');
        expect(TIMING.hour).toBeGreaterThanOrEqual(80);
        expect(TIMING.hour).toBeLessThanOrEqual(120);
        expect(TIMING.levelTurn).toBeLessThan(TIMING.hour);
    });

    it('opens every event before it closes, and breaks the storm faster than it closes again', () => {
        expect(TIMING.gapOpen).toBeLessThan(TIMING.gapLife * 0.45);
        expect(TIMING.tearIn).toBeLessThan(TIMING.tearLife * 0.5);
        expect(TIMING.breakIn).toBeLessThan(TIMING.breakOut);
        expect(TIMING.clearReturn).toBeGreaterThan(0);
        expect(TIMING.dawn).toBeGreaterThan(0);
        expect(TIMING.dusk).toBeGreaterThan(0);
        // A trail of wind runs its course long before the gap it is seen with closes.
        expect(TIMING.trail).toBeLessThan(TIMING.gapLife);
    });
});

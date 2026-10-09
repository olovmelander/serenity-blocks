/**
 * Voltage Storm — the three-free core: slot ranges, a stroke's light in time, a tower's held
 * charge, colours, palettes, the composition for an aspect, and the content tiers.
 *
 * The storm's look is still being tuned, so nothing here pins a gain, a width, a colour or a
 * duration: every expectation is a relation, or is measured against the exported constants.
 */
import { describe, expect, it } from 'vitest';
import {
    AFTERGLOW, BOLT_KIND, BOLT_RANGES, BOLT_SLOTS, BRANCH_DECAY, HELD_MAX, HELD_TAU, MAX_CHAIN_ARCS, PALETTE_DRIFT,
    PALETTE_KEYS, PALETTE_REST, STROKE_DECAY, TOWER_MAX, VOLTAGE_STORM_PALETTES, addHeld, approach, clamp01, hash2,
    heldAt, lerp, mulberry32, paletteAt, paletteMix, palettePhase, pieceColor, powerForCombo, smooth, stormAnchors,
    strokeLife, strokeLight, strokePlan,
} from '../../src/themes/voltage-storm/voltage-storm-core.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/voltage-storm/voltage-storm-quality.js';
import { VOLTAGE_STORM_TETROMINOS } from '../../src/themes/voltage-storm/voltage-storm-tetrominos.js';

/** An empty tower's epoch, as the core writes it. */
const EMPTY = addHeld(-1e9, 0, 0);

/** Aspects the composition must hold for: an upright phone, a square, a desk, an ultrawide. */
const ASPECTS = [0.46, 1, 16 / 9, 21 / 9];

const DARK = Object.freeze({
    grow: 0, main: 0, branch: 0, after: 0,
});

/** `count` ages spread over [from, to]. */
function ages(from, to, count = 200) {
    return Array.from({ length: count + 1 }, (_, i) => from + ((to - from) * i) / count);
}

/** The towers of one side of the card (−1 left, +1 right), nearest first. */
function row(anchors, side) {
    return anchors.towers.filter((tower) => tower.side === side).sort((a, b) => a.row - b.row);
}

describe('voltage storm core: small maths', () => {
    it('eases, clamps and blends', () => {
        expect(clamp01(-2)).toBe(0);
        expect(clamp01(0.3)).toBe(0.3);
        expect(clamp01(7)).toBe(1);
        expect(lerp(2, 6, 0.25)).toBe(3);
        expect(smooth(1, 3, 0)).toBe(0);
        expect(smooth(1, 3, 2)).toBeCloseTo(0.5, 12);
        expect(smooth(1, 3, 9)).toBe(1);
        // The same gap closes by the same fraction however the time is cut up.
        expect(approach(3, 0)).toBe(0);
        expect(1 - (1 - approach(3, 0.1)) ** 2).toBeCloseTo(approach(3, 0.2), 12);
        expect(approach(3, 100)).toBeCloseTo(1, 9);
        // A frame that runs backwards, or a negative rate, closes nothing.
        expect(approach(3, -1)).toBe(0);
        expect(approach(-3, 1)).toBe(0);
    });

    it('draws the same numbers from the same seed, and hashes the same pair to the same number', () => {
        const a = mulberry32(77);
        const b = mulberry32(77);
        const other = mulberry32(78);
        const drawn = Array.from({ length: 500 }, () => a());
        expect(Array.from({ length: 500 }, () => b())).toEqual(drawn);
        expect(Array.from({ length: 500 }, () => other())).not.toEqual(drawn);
        expect(Math.min(...drawn)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...drawn)).toBeLessThan(1);
        // A zero seed still draws.
        const zero = mulberry32(0);
        expect(new Set(Array.from({ length: 50 }, () => zero())).size).toBeGreaterThan(40);

        // The hash: in [0, 1) whenever it is asked, moved by either number, filling the range.
        const values = [];
        for (let i = 0; i < 40; i++) {
            for (let j = 0; j < 40; j++) {
                expect(hash2(i, j)).toBe(hash2(i, j));
                values.push(hash2(i, j));
            }
        }
        expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...values)).toBeLessThan(1);
        expect(hash2(3, 7)).not.toBe(hash2(4, 7));
        expect(hash2(3, 7)).not.toBe(hash2(3, 8));
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        expect(mean).toBeGreaterThan(0.45);
        expect(mean).toBeLessThan(0.55);
        expect(values.filter((v) => v < 0.1).length).toBeGreaterThan(0);
        expect(values.filter((v) => v > 0.9).length).toBeGreaterThan(0);
    });

    it('tiles the bolt table with one range per kind: no gap, no overlap, room for a chain\'s arcs', () => {
        expect(Object.keys(BOLT_RANGES).sort()).toEqual(Object.keys(BOLT_KIND).sort());
        const ranges = Object.values(BOLT_RANGES).map(([from, to]) => ({ from, to })).sort((a, b) => a.from - b.from);
        let cursor = 0;
        for (const range of ranges) {
            expect(range.from).toBe(cursor);
            expect(range.to).toBeGreaterThan(range.from);
            expect(Number.isInteger(range.to)).toBe(true);
            cursor = range.to;
        }
        expect(cursor).toBe(BOLT_SLOTS);
        // The shader tells the kinds apart by their number.
        expect(new Set(Object.values(BOLT_KIND)).size).toBe(Object.keys(BOLT_KIND).length);
        // Every standing arc a chain can raise has a slot of its own.
        expect(BOLT_RANGES.chain[1] - BOLT_RANGES.chain[0]).toBeGreaterThanOrEqual(MAX_CHAIN_ARCS);
    });
});

describe('voltage storm core: a stroke in time', () => {
    it('plans the same bolt for the same seed: the first stroke as the leader lands, the rest after', () => {
        const options = { leader: 0.1, strokes: 4, power: 1.2 };
        expect(strokePlan(5, options)).toEqual(strokePlan(5, options));
        expect(strokePlan(6, options).times).not.toEqual(strokePlan(5, options).times);
        expect(strokePlan(6, options).gains).not.toEqual(strokePlan(5, options).gains);
        for (const seed of [1, 2, 17, 301, 612.5]) {
            for (const strokes of [1, 2, 3, 5, 8]) {
                const leader = 0.04 + seed * 0.0001;
                const plan = strokePlan(seed, { leader, strokes });
                expect(plan.leader).toBe(leader);
                expect(plan.times).toHaveLength(strokes);
                expect(plan.gains).toHaveLength(strokes);
                expect(plan.times[0]).toBe(leader);
                for (let i = 1; i < strokes; i++) expect(plan.times[i]).toBeGreaterThan(plan.times[i - 1]);
                expect(plan.last).toBe(plan.times[strokes - 1]);
            }
        }
    });

    it('makes the first stroke the brightest and scales every stroke with the power', () => {
        for (const seed of [3, 44, 507]) {
            const plan = strokePlan(seed, { strokes: 6, power: 1 });
            const doubled = strokePlan(seed, { strokes: 6, power: 2 });
            expect(plan.gains[0]).toBe(1);
            for (let i = 1; i < plan.gains.length; i++) {
                expect(plan.gains[i]).toBeGreaterThan(0);
                expect(plan.gains[i]).toBeLessThan(plan.gains[0]);
                expect(doubled.gains[i]).toBeCloseTo(plan.gains[i] * 2, 12);
            }
            // The power changes how bright it is, never when it strikes.
            expect(doubled.times).toEqual(plan.times);
        }
    });

    it('is dark before it is born, into whatever object it is handed', () => {
        const plan = strokePlan(9, { strokes: 3 });
        for (const age of [-5, -1e-9, NaN, undefined]) expect(strokeLight(plan, age)).toEqual(DARK);
        const out = { ...DARK, main: 9, after: 9 };
        expect(strokeLight(plan, plan.leader, out)).toBe(out);
        expect(out).toEqual(strokeLight(plan, plan.leader));
        expect(strokeLight(plan, -1, out)).toEqual(DARK);
    });

    it('brings the leader down without ever stepping back, and has it landed from its end on', () => {
        const plan = strokePlan(21, { leader: 0.12, strokes: 3 });
        expect(strokeLight(plan, 0).grow).toBe(0);
        let previous = 0;
        for (const age of ages(0, plan.leader, 400)) {
            const light = strokeLight(plan, age);
            expect(light.grow).toBeGreaterThanOrEqual(previous);
            expect(light.grow).toBeLessThanOrEqual(1);
            // Nothing returns up the channel before the leader has connected.
            if (age < plan.leader) expect(light.main).toBe(0);
            previous = light.grow;
        }
        expect(strokeLight(plan, plan.leader * 0.5).grow).toBeGreaterThan(0);
        expect(strokeLight(plan, plan.leader * 0.5).grow).toBeLessThan(1);
        for (const age of [plan.leader, plan.leader + 1e-6, plan.last, plan.last + 3]) {
            expect(strokeLight(plan, age).grow).toBe(1);
        }
    });

    it('jumps at each return stroke and cools between them, to 1/e in STROKE_DECAY', () => {
        const plan = strokePlan(33, { leader: 0.1, strokes: 4, power: 1.3 });
        const tiny = 1e-7;
        expect(strokeLight(plan, plan.times[0]).main).toBe(plan.gains[0]);
        for (let i = 0; i < plan.times.length; i++) {
            const before = strokeLight(plan, plan.times[i] - tiny).main;
            const at = strokeLight(plan, plan.times[i]).main;
            expect(at - before).toBeCloseTo(plan.gains[i], 4);
            // Between this stroke and the next (or the end) the channel only cools.
            const until = i + 1 < plan.times.length ? plan.times[i + 1] - tiny : plan.times[i] + 0.5;
            let previous = at;
            for (const age of ages(plan.times[i], until, 60).slice(1)) {
                const { main } = strokeLight(plan, age);
                expect(main).toBeLessThan(previous);
                expect(main).toBeGreaterThan(0);
                previous = main;
            }
        }
        const single = strokePlan(4, { leader: 0.08, strokes: 1, power: 0.9 });
        expect(strokeLight(single, single.leader + STROKE_DECAY).main).toBeCloseTo(0.9 / Math.E, 9);
    });

    it('flashes the branches on the first stroke only', () => {
        const plan = strokePlan(12, { leader: 0.1, strokes: 4 });
        const tiny = 1e-7;
        expect(strokeLight(plan, plan.times[0] - tiny).branch).toBe(0);
        expect(strokeLight(plan, plan.times[0]).branch).toBe(plan.gains[0]);
        expect(strokeLight(plan, plan.times[0] + BRANCH_DECAY).branch).toBeCloseTo(plan.gains[0] / Math.E, 9);
        // A later stroke lights the channel again; the branches go on fading through it.
        for (let i = 1; i < plan.times.length; i++) {
            const before = strokeLight(plan, plan.times[i] - tiny);
            const at = strokeLight(plan, plan.times[i]);
            expect(at.main).toBeGreaterThan(before.main);
            expect(at.branch).toBeLessThan(before.branch);
        }
        let previous = Infinity;
        for (const age of ages(plan.times[0], plan.last + 0.3, 120)) {
            const { branch } = strokeLight(plan, age);
            expect(branch).toBeLessThan(previous);
            previous = branch;
        }
    });

    it('starts the afterglow at the last stroke and cools it from there', () => {
        const plan = strokePlan(8, { leader: 0.1, strokes: 3, power: 1.1 });
        for (const age of ages(0, plan.last - 1e-7, 50)) expect(strokeLight(plan, age).after).toBe(0);
        expect(strokeLight(plan, plan.last).after).toBe(plan.gains[0]);
        expect(strokeLight(plan, plan.last + AFTERGLOW).after).toBeCloseTo(plan.gains[0] / Math.E, 9);
        let previous = Infinity;
        for (const age of ages(plan.last, plan.last + AFTERGLOW * 4, 80)) {
            const { after } = strokeLight(plan, age);
            expect(after).toBeLessThan(previous);
            previous = after;
        }
        // The channel's glow outlasts the stroke that made it.
        expect(AFTERGLOW).toBeGreaterThan(STROKE_DECAY);
    });

    it('lives on past its last stroke, until there is nothing left to show', () => {
        for (const strokes of [1, 3, 6]) {
            const plan = strokePlan(70 + strokes, { strokes, power: 1.5 });
            const life = strokeLife(plan);
            expect(life).toBeGreaterThan(plan.last);
            const end = strokeLight(plan, life);
            expect(end.main / plan.gains[0]).toBeLessThan(0.02);
            expect(end.branch / plan.gains[0]).toBeLessThan(0.02);
            expect(end.after / plan.gains[0]).toBeLessThan(0.06);
            // And it is not held on to long after that: a quarter of the way there it still glows.
            const quarter = strokeLight(plan, plan.last + (life - plan.last) * 0.25);
            expect(quarter.after / plan.gains[0]).toBeGreaterThan(0.1);
        }
    });
});

describe('voltage storm core: what a tower holds', () => {
    it('reads an empty tower as empty, and leaves it empty when nothing arrives', () => {
        for (const time of [-50, 0, 12.5, 1e6]) {
            for (const epoch of [EMPTY, -1e9, -Infinity, NaN, undefined]) expect(heldAt(epoch, time)).toBe(0);
        }
        expect(heldAt(addHeld(EMPTY, 5, 0), 5)).toBe(0);
        expect(heldAt(addHeld(EMPTY, 5, 0), 5000)).toBe(0);
        expect(heldAt(addHeld(EMPTY, 5, -3), 5)).toBe(0);
        // Nothing is taken away either.
        const some = addHeld(EMPTY, 5, 0.7);
        expect(heldAt(addHeld(some, 5, 0), 5)).toBeCloseTo(0.7, 12);
        expect(heldAt(addHeld(some, 5, -3), 5)).toBeCloseTo(0.7, 12);
        // A charge that has faded to nothing is an empty tower again.
        expect(heldAt(addHeld(some, 5 + HELD_TAU * 40, 0), 5 + HELD_TAU * 40)).toBe(0);
    });

    it('adds what arrives to what is there', () => {
        const first = addHeld(EMPTY, 40, 0.5);
        expect(heldAt(first, 40)).toBeCloseTo(0.5, 12);
        const second = addHeld(first, 40, 0.3);
        expect(heldAt(second, 40)).toBeCloseTo(0.8, 12);
        // Later, it is added to what is left by then.
        const left = heldAt(second, 47);
        expect(heldAt(addHeld(second, 47, 0.25), 47)).toBeCloseTo(left + 0.25, 12);
        // One arrival or two halves of it: the same charge.
        expect(heldAt(addHeld(addHeld(EMPTY, 3, 0.2), 3, 0.2), 3)).toBeCloseTo(heldAt(addHeld(EMPTY, 3, 0.4), 3), 12);
    });

    it('never holds more than HELD_MAX', () => {
        expect(HELD_MAX).toBeGreaterThan(0);
        const full = addHeld(EMPTY, 10, HELD_MAX * 3);
        expect(heldAt(full, 10)).toBeCloseTo(HELD_MAX, 12);
        let epoch = EMPTY;
        for (let i = 0; i < 50; i++) {
            epoch = addHeld(epoch, 10 + i * 0.1, HELD_MAX * 0.4);
            expect(heldAt(epoch, 10 + i * 0.1)).toBeLessThanOrEqual(HELD_MAX + 1e-12);
        }
        expect(heldAt(epoch, 15)).toBeGreaterThan(HELD_MAX * 0.9);
        // Asked about a moment before the charge arrived, it still reads no more than a full tower.
        expect(heldAt(full, -1000)).toBe(HELD_MAX);
    });

    it('fades to 1/e in HELD_TAU and never rises on its own', () => {
        const epoch = addHeld(EMPTY, 100, 0.9);
        expect(heldAt(epoch, 100 + HELD_TAU)).toBeCloseTo(0.9 / Math.E, 12);
        expect(heldAt(epoch, 100 + HELD_TAU * 2)).toBeCloseTo(0.9 / Math.E ** 2, 12);
        let previous = Infinity;
        for (const time of ages(100, 100 + HELD_TAU * 6, 120)) {
            const held = heldAt(epoch, time);
            expect(held).toBeLessThan(previous);
            expect(held).toBeGreaterThan(0);
            previous = held;
        }
        // A tower keeps a lock's charge far longer than any bolt lasts.
        expect(HELD_TAU).toBeGreaterThan(strokeLife(strokePlan(1, { strokes: 8 })));
    });

    it('charges the chain with the combo: nothing at rest, more with every step, never full', () => {
        expect(powerForCombo(0)).toBe(0);
        expect(powerForCombo(-4)).toBe(0);
        let previous = 0;
        for (let combo = 1; combo <= 40; combo++) {
            const power = powerForCombo(combo);
            expect(power).toBeGreaterThan(previous);
            expect(power).toBeLessThan(1);
            previous = power;
        }
        // The first steps count for most.
        expect(powerForCombo(2) - powerForCombo(1)).toBeGreaterThan(powerForCombo(12) - powerForCombo(11));
    });
});

describe('voltage storm core: colour', () => {
    it('reads a piece\'s colour from a hex string, with or without its hash, and from a number', () => {
        expect(pieceColor('#ff7a1a')).toEqual(pieceColor('ff7a1a'));
        expect(pieceColor('#FF7A1A')).toEqual(pieceColor('#ff7a1a'));
        expect(pieceColor('  #ff7a1a ')).toEqual(pieceColor('#ff7a1a'));
        expect(pieceColor(0xff7a1a)).toEqual(pieceColor('#ff7a1a'));
        expect(pieceColor(0x00ff00)).toEqual(pieceColor('#00ff00'));
        // Two pieces, two colours.
        expect(pieceColor('#ff7a1a')).not.toEqual(pieceColor('#1ef0ff'));
    });

    it('normalises the peak to one, leaves no channel dead and keeps the hue', () => {
        const colours = Object.values(VOLTAGE_STORM_TETROMINOS.colors);
        const steps = ['00', '33', '80', 'ff'];
        for (const r of steps) for (const g of steps) for (const b of steps) colours.push(`#${r}${g}${b}`);
        for (const colour of colours.filter((c) => c !== '#000000')) {
            const rgb = pieceColor(colour);
            expect(rgb, colour).toHaveLength(3);
            expect(Math.max(...rgb), colour).toBeCloseTo(1, 12);
            expect(Math.min(...rgb), colour).toBeGreaterThan(0);
            for (const channel of rgb) expect(Number.isFinite(channel), colour).toBe(true);
        }
        // The piece's brightest channel is the arc's, its dimmest the arc's dimmest.
        const [r, g, b] = pieceColor('#ff2a3d');
        expect(r).toBeGreaterThan(b);
        expect(b).toBeGreaterThan(g);
        const cyan = pieceColor('#1ef0ff');
        expect(cyan[2]).toBeGreaterThan(cyan[1]);
        expect(cyan[1]).toBeGreaterThan(cyan[0]);
        // A grey piece throws a white arc.
        expect(new Set(pieceColor('#808080')).size).toBe(1);
    });

    it('falls back for anything that is not a colour, with a copy the caller may keep', () => {
        const fallback = pieceColor(undefined);
        expect(fallback).toHaveLength(3);
        for (const junk of [null, '', 'nope', '#fff', '#12345', '#1234567', 'gggggg', NaN, Infinity, {}, [], true]) {
            expect(pieceColor(junk), String(junk)).toEqual(fallback);
        }
        const own = [0.2, 0.4, 0.6];
        const answer = pieceColor('nope', own);
        expect(answer).toEqual(own);
        answer[0] = 9;
        expect(own[0]).toBe(0.2);
        expect(pieceColor(undefined)).toEqual(fallback);
    });

    it('has six storms, each with a name of its own and every key as a finite, non-negative colour', () => {
        expect(VOLTAGE_STORM_PALETTES).toHaveLength(6);
        expect(Object.isFrozen(VOLTAGE_STORM_PALETTES)).toBe(true);
        expect(new Set(VOLTAGE_STORM_PALETTES.map((palette) => palette.name)).size).toBe(6);
        expect(new Set(PALETTE_KEYS).size).toBe(PALETTE_KEYS.length);
        for (const palette of VOLTAGE_STORM_PALETTES) {
            expect(typeof palette.name).toBe('string');
            expect(palette.name.length).toBeGreaterThan(0);
            expect(Object.keys(palette).sort(), palette.name).toEqual(['name', ...PALETTE_KEYS].sort());
            expect(Object.isFrozen(palette), palette.name).toBe(true);
            for (const key of PALETTE_KEYS) {
                const colour = palette[key];
                expect(Array.isArray(colour), `${palette.name}.${key}`).toBe(true);
                expect(colour, `${palette.name}.${key}`).toHaveLength(3);
                for (const channel of colour) {
                    expect(Number.isFinite(channel), `${palette.name}.${key}`).toBe(true);
                    expect(channel, `${palette.name}.${key}`).toBeGreaterThanOrEqual(0);
                }
                // Nothing a storm is lit by is black: there is always something to see.
                expect(Math.max(...colour), `${palette.name}.${key}`).toBeGreaterThan(0);
            }
        }
    });
});

describe('voltage storm core: the composition for an aspect', () => {
    it('stands ten towers, five either side of the card, each row in order of distance, the hero nearest', () => {
        for (const aspect of ASPECTS) {
            const anchors = stormAnchors(aspect);
            expect(anchors.towers).toHaveLength(10);
            expect(anchors.towers.length).toBeLessThanOrEqual(TOWER_MAX);
            for (const side of [-1, 1]) {
                const towers = row(anchors, side);
                expect(towers.map((tower) => tower.row)).toEqual([0, 1, 2, 3, 4]);
                for (let i = 1; i < towers.length; i++) {
                    expect(towers[i].dist, `${aspect} ${side} ${i}`).toBeGreaterThan(towers[i - 1].dist);
                }
            }
            for (const tower of anchors.towers) {
                expect(tower.dist).toBeGreaterThan(0);
                expect(tower.height).toBeGreaterThan(0);
            }
            // The hero is listed first and stands nearest of all.
            expect(anchors.towers[0].row).toBe(0);
            expect(Math.min(...anchors.towers.map((tower) => tower.dist))).toBe(anchors.towers[0].dist);
        }
    });

    it('keeps every tower in the frame, and the left row left of the right one', () => {
        for (let aspect = 0.3; aspect <= 3.2; aspect += 0.05) {
            const anchors = stormAnchors(aspect);
            const left = row(anchors, -1);
            const right = row(anchors, 1);
            for (let i = 0; i < 5; i++) {
                expect(left[i].sx, `${aspect} left ${i}`).toBeGreaterThan(0);
                expect(right[i].sx, `${aspect} right ${i}`).toBeLessThan(1);
                expect(left[i].sx, `${aspect} row ${i}`).toBeLessThan(right[i].sx);
            }
        }
        for (const aspect of ASPECTS) {
            const anchors = stormAnchors(aspect);
            // The whole of one row stands left of the whole of the other: the card hangs between.
            expect(Math.max(...row(anchors, -1).map((tower) => tower.sx))).toBeLessThan(0.5);
            expect(Math.min(...row(anchors, 1).map((tower) => tower.sx))).toBeGreaterThan(0.5);
        }
    });

    it('holds the horizon in the lower half of the frame and a lens it can be drawn with', () => {
        for (let aspect = 0.3; aspect <= 3.2; aspect += 0.1) {
            const anchors = stormAnchors(aspect);
            expect(anchors.horizon).toBeGreaterThan(0);
            expect(anchors.horizon).toBeLessThan(0.5);
            expect(anchors.hFov).toBeGreaterThan(0);
            expect(anchors.hFov).toBeLessThan(180);
        }
    });

    it('moves nothing with a jump as the window is dragged from a phone\'s shape to a desk\'s', () => {
        const step = 0.01;
        let previous = stormAnchors(0.3);
        for (let aspect = 0.3 + step; aspect <= 3.2; aspect += step) {
            const anchors = stormAnchors(aspect);
            expect(Math.abs(anchors.horizon - previous.horizon)).toBeLessThan(0.01);
            for (let i = 0; i < anchors.towers.length; i++) {
                const now = anchors.towers[i];
                const was = previous.towers[i];
                expect(Math.abs(now.sx - was.sx), `${aspect} tower ${i}`).toBeLessThan(0.02);
                expect(Math.abs(now.dist - was.dist) / was.dist, `${aspect} tower ${i}`).toBeLessThan(0.04);
                expect(Math.abs(now.height - was.height) / was.height, `${aspect} tower ${i}`).toBeLessThan(0.04);
            }
            previous = anchors;
        }
    });

    it('answers a silly aspect with a frame that can still be stood', () => {
        const desk = stormAnchors(16 / 9);
        for (const aspect of [NaN, undefined, null, 'wide', Infinity, -Infinity]) {
            expect(stormAnchors(aspect), String(aspect)).toEqual(desk);
        }
        for (const aspect of [0, -1, 1e-9, 1e9]) {
            const anchors = stormAnchors(aspect);
            expect(Number.isFinite(anchors.aspect)).toBe(true);
            expect(anchors.aspect).toBeGreaterThan(0);
            expect(Number.isFinite(anchors.horizon)).toBe(true);
            expect(anchors.towers).toHaveLength(10);
            for (const tower of anchors.towers) {
                for (const value of [tower.sx, tower.dist, tower.height]) expect(Number.isFinite(value)).toBe(true);
                expect(tower.sx).toBeGreaterThan(0);
                expect(tower.sx).toBeLessThan(1);
            }
        }
        // Beyond the shapes it knows, it holds the last one.
        expect(stormAnchors(1e9).towers).toEqual(stormAnchors(50).towers);
        expect(stormAnchors(1e-9).towers).toEqual(stormAnchors(0.01).towers);
    });
});

describe('voltage storm quality tiers', () => {
    it('keeps the whole picture on every tier', () => {
        expect(QUALITY_NAMES).toEqual(Object.keys(QUALITY));
        const keys = Object.keys(QUALITY.High).sort();
        for (const name of QUALITY_NAMES) {
            const tier = QUALITY[name];
            expect(Object.keys(tier).sort(), name).toEqual(keys);
            expect(Object.isFrozen(tier), name).toBe(true);
            expect(tier.skyScale, name).toBeGreaterThan(0);
            expect(tier.skyScale, name).toBeLessThanOrEqual(1);
            expect(tier.march, name).toBeGreaterThanOrEqual(1);
            // A tower either side of the card at the least, and no more than the table has rows for.
            expect(tier.towers, name).toBeGreaterThanOrEqual(2);
            expect(tier.towers, name).toBeLessThanOrEqual(TOWER_MAX);
            expect(tier.rain, name).toBeGreaterThan(0);
            expect(tier.sparks, name).toBeGreaterThan(0);
            expect([0, 1, 2], name).toContain(tier.boltDetail);
            for (const count of [tier.march, tier.towers, tier.rain, tier.sparks, tier.noise3d]) {
                expect(Number.isInteger(count), name).toBe(true);
            }
        }
    });

    it('never asks less of a higher tier', () => {
        const counted = ['skyScale', 'march', 'towers', 'rain', 'sparks', 'boltDetail', 'noise3d'];
        const switched = ['detail', 'flashSteps', 'mirror'];
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const lower = QUALITY[QUALITY_NAMES[i - 1]];
            const higher = QUALITY[QUALITY_NAMES[i]];
            for (const key of counted) {
                expect(higher[key], `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(lower[key]);
            }
            for (const key of switched) {
                expect(typeof higher[key], `${QUALITY_NAMES[i]}.${key}`).toBe('boolean');
                if (lower[key]) expect(higher[key], `${QUALITY_NAMES[i]}.${key}`).toBe(true);
            }
        }
    });

    it('answers a tier it does not know with High', () => {
        for (const name of QUALITY_NAMES) expect(tierFor(name)).toBe(QUALITY[name]);
        expect(tierFor('Ludicrous')).toBe(QUALITY.High);
        expect(tierFor(undefined)).toBe(QUALITY.High);
        expect(tierFor('high')).toBe(QUALITY.High);
    });
});

describe('voltage storm core: the wheel of palettes', () => {
    const n = VOLTAGE_STORM_PALETTES.length;

    it('puts a level one step on and the clock one step every PALETTE_DRIFT seconds', () => {
        expect(palettePhase(1, 0)).toBe(0);
        expect(palettePhase(2, 0)).toBe(1);
        expect(palettePhase(1, PALETTE_DRIFT)).toBeCloseTo(1, 12);
        expect(palettePhase(4, PALETTE_DRIFT * 2.5)).toBeCloseTo(5.5, 12);
        expect(PALETTE_DRIFT).toBeGreaterThan(20); // slowly: a step is not a matter of seconds
        // Silly input stands at the start.
        [[NaN, 0], [undefined, undefined], [0, -5], [-3, NaN], [Infinity, Infinity]].forEach(([level, time]) => {
            expect(palettePhase(level, time)).toBe(0);
        });
    });

    it('rests on each palette, mixes smoothly into the next and comes round to the first', () => {
        expect(paletteMix(0)).toMatchObject({ from: 0, to: 1, mix: 0 });
        expect(paletteMix(PALETTE_REST * 0.9).mix).toBe(0);
        expect(paletteMix(1 - PALETTE_REST * 0.9).mix).toBe(1);
        expect(paletteMix(0.5).mix).toBeCloseTo(0.5, 12);
        expect(paletteMix(n - 0.5)).toMatchObject({ from: n - 1, to: 0 });
        expect(paletteMix(n * 3 + 2.25)).toMatchObject({ from: 2, to: 3 });
        let previous = -1;
        for (let i = 0; i <= 200; i++) {
            const { mix } = paletteMix(i / 200 - 1e-12 * (i === 200));
            expect(mix).toBeGreaterThanOrEqual(Math.max(0, previous));
            expect(mix).toBeLessThanOrEqual(1);
            previous = mix;
        }
        // No jump where one step ends and the next begins.
        const before = paletteAt(1 - 1e-9);
        const after = paletteAt(1 + 1e-9);
        PALETTE_KEYS.forEach((key) => before[key].forEach((v, c) => expect(after[key][c]).toBeCloseTo(v, 6)));
        [NaN, -2, undefined].forEach((phase) => expect(paletteMix(phase)).toMatchObject({ from: 0, to: 1, mix: 0 }));
    });

    it('gives each named palette exactly at its place, and their mean half-way between two', () => {
        for (let i = 0; i < n; i++) {
            const at = paletteAt(i);
            PALETTE_KEYS.forEach((key) => expect(at[key], `${VOLTAGE_STORM_PALETTES[i].name}.${key}`)
                .toEqual(VOLTAGE_STORM_PALETTES[i][key]));
            const between = paletteAt(i + 0.5);
            const next = VOLTAGE_STORM_PALETTES[(i + 1) % n];
            PALETTE_KEYS.forEach((key) => between[key].forEach((v, c) => {
                expect(v).toBeCloseTo((VOLTAGE_STORM_PALETTES[i][key][c] + next[key][c]) / 2, 12);
            }));
        }
        // It writes into what it is given and never into the palettes themselves.
        const out = {};
        expect(paletteAt(0.5, out)).toBe(out);
        const again = paletteAt(2, out);
        PALETTE_KEYS.forEach((key) => expect(again[key]).toEqual(VOLTAGE_STORM_PALETTES[2][key]));
        expect(VOLTAGE_STORM_PALETTES.every((palette) => Object.isFrozen(palette))).toBe(true);
    });

    it('lays the palettes round the wheel so that no step passes through grey', () => {
        // Half-way between any two neighbours the strip at the horizon still has a colour of its
        // own: its strongest channel stands clear of its weakest.
        for (let i = 0; i < n; i++) {
            const { horizon } = paletteAt(i + 0.5);
            const hi = Math.max(...horizon);
            const lo = Math.min(...horizon);
            expect((hi - lo) / hi, `${VOLTAGE_STORM_PALETTES[i].name} → next`).toBeGreaterThan(0.3);
            // And the sky above the strip is not grey either (amber straight into green was).
            const { gap } = paletteAt(i + 0.5);
            const top = Math.max(...gap);
            const spread = (top - Math.min(...gap)) / top;
            expect(spread, `${VOLTAGE_STORM_PALETTES[i].name} → next, gap`).toBeGreaterThan(0.3);
        }
    });
});

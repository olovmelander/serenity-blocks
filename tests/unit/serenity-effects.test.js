import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import { ComboTracker } from '../../src/core/combo-tracker.js';
import { COLORS, COLS } from '../../src/core/constants.js';
import { calculateLineClearScore } from '../../src/core/scoring.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import {
    B2B_MS, BREAK_MS, EFFECTS, EFFECT_GROUPS, FEVER_MS, FLOOR_ROW, LOCK_MS, RUSH_MS, SOURCE, SerenityEffects,
    TOUR_REST_MS, WAVE_MS, buildEffect, createEffectContext, effectDuration, rowsFromFloor,
} from '../../src/ui/serenity-mode/serenity-effects.js';

/**
 * Serenity Mode's theme effects: each is the gameplay events real play sends, in the pinned
 * physics order (tests/unit/physics-callback-schedule.test.js), through the canonical emitters,
 * and each stands on its own however they are pressed.
 */

const build = (id, ctx = createEffectContext()) => buildEffect(id, ctx);
const types = (steps) => steps.map((step) => step.type);

/** Every board cell a locked piece covers, as [column, row]. */
function cells(piece) {
    const out = [];
    piece.shape.forEach((row, dy) => row.forEach((cell, dx) => {
        if (cell) out.push([piece.x + dx, piece.y + dy]);
    }));
    return out;
}

/** What a theme's combo counter makes of the steps (src/core/combo-tracker.js). */
function comboAtEachClear(steps, tracker = new ComboTracker()) {
    const seen = [];
    steps.forEach((step) => {
        if (step.type === 'pieceLock') tracker.notePieceLocked();
        if (step.type === 'lineClear') {
            tracker.noteLineClear();
            seen.push(tracker.combo);
        }
    });
    return seen;
}

describe('the effects', () => {
    it('are sixteen, each with its own id, in a known group', () => {
        expect(EFFECTS).toHaveLength(16);
        expect(new Set(EFFECTS.map((effect) => effect.id)).size).toBe(EFFECTS.length);
        const groups = EFFECT_GROUPS.map((group) => group.id);
        EFFECTS.forEach((effect) => {
            expect(groups).toContain(effect.group);
            expect(effect.label).toBeTruthy();
            expect(effect.name).toBeTruthy();
        });
        // The tray and Play all read them group by group.
        const order = EFFECTS.map((effect) => groups.indexOf(effect.group));
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('send only events themes know, every one tagged, set down on the board', () => {
        const known = new Set(['hardDrop', 'pieceLock', 'lineClear', 'combo', 'levelUp', 'tspin', 'b2b', 'perfectClear']);
        const ctx = createEffectContext();
        EFFECTS.forEach((effect) => {
            const steps = build(effect.id, ctx);
            expect(steps.length).toBeGreaterThan(0);
            steps.forEach((step, i) => {
                expect(known.has(step.type)).toBe(true);
                expect(step.payload.source).toBe(SOURCE);
                if (i > 0) expect(step.at).toBeGreaterThanOrEqual(steps[i - 1].at);
                if (step.payload.piece) {
                    cells(step.payload.piece).forEach(([x, y]) => {
                        expect(x).toBeGreaterThanOrEqual(0);
                        expect(x).toBeLessThan(COLS);
                        expect(y).toBeLessThanOrEqual(FLOOR_ROW);
                    });
                }
            });
        });
    });

    it('lock a piece resting on the floor, a different shape each press', () => {
        const ctx = createEffectContext();
        const shapes = [];
        for (let i = 0; i < 7; i += 1) {
            const [step] = build('lock', ctx);
            expect(step.type).toBe('pieceLock');
            expect(Math.max(...cells(step.payload.piece).map(([, y]) => y))).toBe(FLOOR_ROW);
            shapes.push(step.payload.piece.shapeKey);
        }
        expect(new Set(shapes).size).toBe(7);
    });

    it('hard drop in the same tick as the lock, from the spawn row down', () => {
        const steps = build('hard-drop');
        expect(types(steps)).toEqual(['hardDrop', 'pieceLock']);
        expect(steps.map((step) => step.at)).toEqual([0, 0]);
        expect(steps[0].payload.piece).toBe(steps[1].payload.piece);
        expect(steps[0].payload.endY).toBeGreaterThan(steps[0].payload.startY);
    });

    it.each([['single', 1], ['double', 2], ['triple', 3], ['quad', 4]])(
        'clear %s: the rows at the bottom, by a piece that fills them',
        (id, lines) => {
            const steps = build(id);
            expect(types(steps)).toEqual(['pieceLock', 'lineClear']);
            const { lineCount, clearedRows, cascadeCount } = steps[1].payload;
            expect({ lineCount, clearedRows, cascadeCount }).toEqual({
                lineCount: lines, clearedRows: rowsFromFloor(lines), cascadeCount: 1,
            });
            const rows = new Set(cells(steps[0].payload.piece).map(([, y]) => y));
            clearedRows.forEach((row) => expect(rows.has(row)).toBe(true));
        },
    );

    it.each([['cascade-3', 3], ['cascade-6', 6], ['cascade-10', 10]])(
        '%s: one lock, then a wave every WAVE_MS, COMBO (the depth) first in each later wave',
        (id, depth) => {
            const steps = build(id);
            expect(types(steps).filter((type) => type === 'pieceLock')).toHaveLength(1);
            const clears = steps.filter((step) => step.type === 'lineClear');
            expect(clears.map((step) => step.payload.cascadeCount)).toEqual(
                Array.from({ length: depth }, (_, i) => i + 1),
            );
            clears.slice(1).forEach((clear, i) => {
                expect(clear.at - clears[i].at).toBe(WAVE_MS);
                const before = steps[steps.indexOf(clear) - 1];
                expect(before).toMatchObject({ type: 'combo', at: clear.at, payload: { comboCount: i + 2 } });
            });
        },
    );

    it('combo: five clearing locks in a row, which a theme counts to five', () => {
        const steps = build('combo');
        expect(comboAtEachClear(steps)).toEqual([1, 2, 3, 4, 5]);
        const locks = steps.filter((step) => step.type === 'pieceLock');
        expect(locks.map((step) => step.at)).toEqual([0, 1, 2, 3, 4].map((n) => n * LOCK_MS));
    });

    it('T-spin: a T clearing two rows, TSPIN right after its LINE_CLEAR', () => {
        const steps = build('tspin');
        expect(types(steps)).toEqual(['pieceLock', 'lineClear', 'tspin']);
        expect(steps[0].payload.piece.shapeKey).toBe('T');
        expect(steps[2].payload).toMatchObject({ lineCount: 2 });
    });

    it('back-to-back: two quads with a plain piece between, B2B after the second', () => {
        const steps = build('b2b');
        expect(types(steps)).toEqual(['pieceLock', 'lineClear', 'pieceLock', 'pieceLock', 'lineClear', 'b2b']);
        expect(steps[2].at).toBe(B2B_MS);
        expect(steps[3].at).toBe(B2B_MS + BREAK_MS);
        expect(steps[5].payload).toMatchObject({ active: true });
        // Back-to-back, not a combo of two.
        expect(comboAtEachClear(steps)).toEqual([1, 1]);
    });

    it('perfect clear: after the quad has settled, with the bonus physics would give', () => {
        const steps = build('perfect-clear');
        expect(types(steps)).toEqual(['pieceLock', 'lineClear', 'perfectClear']);
        expect(steps[2].at - steps[1].at).toBe(WAVE_MS);
        const bonus = calculateLineClearScore(4, 1, 1, true) - calculateLineClearScore(4, 1, 1, false);
        expect(steps[2].payload).toMatchObject({ depth: 4, perfectClearBonus: bonus });
        expect(bonus).toBeGreaterThan(0);
    });

    it('level up: LEVEL_UP before the clear that crosses it, one level higher each press', () => {
        const ctx = createEffectContext();
        const first = build('level-up', ctx);
        expect(types(first)).toEqual(['pieceLock', 'levelUp', 'lineClear']);
        expect(first[1].payload.level).toBe(2);
        const second = build('level-up', ctx);
        expect(second.find((step) => step.type === 'levelUp').payload.level).toBe(3);
    });

    it("rush: twenty hard drops at a quick hand's pace, clears between plain pieces, a quad last", () => {
        const steps = build('rush');
        const locks = steps.filter((step) => step.type === 'pieceLock');
        expect(locks).toHaveLength(20);
        expect(locks.map((step) => step.at)).toEqual(locks.map((_, n) => n * RUSH_MS));
        // Every lock is hard-dropped, in the same tick and just before it.
        locks.forEach((step) => {
            const before = steps[steps.indexOf(step) - 1];
            expect(before).toMatchObject({ type: 'hardDrop', at: step.at });
            expect(before.payload.piece).toBe(step.payload.piece);
        });
        const clears = steps.filter((step) => step.type === 'lineClear');
        expect(clears.map((step) => step.payload.lineCount)).toEqual([1, 2, 1, 2, 4]);
        // Plain pieces between: the pace builds, not a combo.
        expect(comboAtEachClear(steps)).toEqual([1, 1, 1, 1, 1]);
    });

    it('fever: twelve clearing locks in a row, counted one to twelve, to a perfect clear', () => {
        const steps = build('fever');
        expect(comboAtEachClear(steps.filter((step) => step.type !== 'lineClear' || step.payload.cascadeCount === 1)))
            .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        const locks = steps.filter((step) => step.type === 'pieceLock');
        expect(locks).toHaveLength(12);
        locks.forEach((step) => expect(steps[steps.indexOf(step) - 1].type).toBe('hardDrop'));
        // A T-spin, a four-wave cascade, and the board emptied at the end.
        const tspin = steps.find((step) => step.type === 'tspin');
        expect(steps[steps.indexOf(tspin) - 1].type).toBe('lineClear');
        const waves = steps.filter((step) => step.type === 'combo').map((step) => step.payload.comboCount);
        expect(waves).toEqual([2, 3, 4]);
        expect(steps[steps.length - 1].type).toBe('perfectClear');
        expect(steps[steps.length - 1].at - steps[steps.length - 2].at).toBe(WAVE_MS);
        // The pace of a chain: a lock every FEVER_MS, the cascade's waves within its step.
        const gaps = locks.slice(1).map((step, n) => step.at - locks[n].at);
        expect(gaps.filter((gap) => gap === FEVER_MS).length).toBe(10);
    });
});

describe('each effect stands on its own', () => {
    it('a clear after a clear first sets down one plain piece, so it is not a combo', () => {
        const ctx = createEffectContext();
        const tracker = new ComboTracker();
        expect(comboAtEachClear(build('single', ctx), tracker)).toEqual([1]);
        const double = build('double', ctx);
        expect(types(double)).toEqual(['pieceLock', 'pieceLock', 'lineClear']);
        expect(double.map((step) => step.at)).toEqual([0, BREAK_MS, BREAK_MS]);
        expect(comboAtEachClear(double, tracker)).toEqual([1]);
        // A combo after the double begins at one too.
        expect(comboAtEachClear(build('combo', ctx), tracker)).toEqual([1, 2, 3, 4, 5]);
    });

    it('needs no plain piece after one that cleared nothing', () => {
        const ctx = createEffectContext();
        build('single', ctx);
        build('hard-drop', ctx);
        expect(types(build('quad', ctx))).toEqual(['pieceLock', 'lineClear']);
    });

    it('wears the theme\'s colours when it has them, the standard ones when not', () => {
        const themed = createEffectContext({ colorFor: (key) => (key === 'I' ? '#123456' : null) });
        const quad = build('quad', themed)[0].payload.piece;
        expect(quad.color).toBe('#123456');
        const plain = build('tspin', createEffectContext())[0].payload.piece;
        expect(plain.color).toBe(COLORS.T);
    });
});

describe('through the canonical emitters', () => {
    afterEach(() => {
        for (const name of [...eventBus.listeners.keys()]) eventBus.listeners.delete(name);
    });

    it('reach the themes in the shapes they read', () => {
        const seen = [];
        const names = {
            [EVENTS.HARD_DROP]: 'hardDrop',
            [EVENTS.PIECE_LOCK]: 'pieceLock',
            [EVENTS.LINE_CLEAR]: 'lineClear',
            [EVENTS.COMBO]: 'combo',
            [EVENTS.LEVEL_UP]: 'levelUp',
            [EVENTS.TSPIN]: 'tspin',
            [EVENTS.B2B]: 'b2b',
            [EVENTS.PERFECT_CLEAR]: 'perfectClear',
        };
        Object.entries(names).forEach(([event, type]) => {
            eventBus.on(event, (payload) => seen.push({ type, payload }));
        });
        vi.useFakeTimers();
        try {
            const player = new SerenityEffects();
            const ctx = createEffectContext();
            EFFECTS.forEach((effect) => {
                const expected = buildEffect(effect.id, ctx);
                seen.length = 0;
                player.play(effect.id);
                vi.advanceTimersByTime(effectDuration(expected) + 1000);
                expect(seen.map((entry) => entry.type)).toEqual(types(expected));
            });
        } finally {
            vi.useRealTimers();
        }
        // The consumer-audit rules (src/events/gameplay-events.js).
        seen.forEach(({ type, payload }) => {
            expect(payload).not.toHaveProperty('detail');
            if (type === 'pieceLock') expect(payload).not.toHaveProperty('timestamp');
            if (type === 'lineClear') {
                expect(Array.isArray(payload.clearedRows)).toBe(true);
                expect(payload.cascadeCount).toBeGreaterThanOrEqual(1);
            }
            if (type === 'hardDrop') expect(payload.distance).toBeGreaterThan(0);
            expect(payload.source).toBe(SOURCE);
        });
    });
});

describe('the player', () => {
    let emitted;
    let states;
    let tour;
    let player;

    beforeEach(() => {
        vi.useFakeTimers();
        emitted = [];
        states = [];
        tour = [];
        player = new SerenityEffects({
            emit: (step) => emitted.push(step.type),
            onChange: (state) => states.push(state),
            onTourStep: (effect, index, total) => tour.push([effect.id, index, total]),
        });
    });

    afterEach(() => vi.useRealTimers());

    it('sends the first events at once and the rest on time, then says it is done', () => {
        expect(player.play('cascade-3')).toBe(true);
        expect(emitted).toEqual(['pieceLock', 'lineClear']);
        expect(states.at(-1)).toEqual({ playing: 'cascade-3', touring: false });
        vi.advanceTimersByTime(2 * WAVE_MS);
        expect(emitted).toEqual(['pieceLock', 'lineClear', 'combo', 'lineClear', 'combo', 'lineClear']);
        vi.advanceTimersByTime(1000);
        expect(states.at(-1)).toEqual({ playing: null, touring: false });
        expect(player.play('no-such-effect')).toBe(false);
    });

    it('ends the effect before when a new one starts: play never overlaps two locks', () => {
        player.play('cascade-10');
        player.play('lock');
        vi.advanceTimersByTime(10000);
        expect(emitted).toEqual(['pieceLock', 'lineClear', 'pieceLock']);
    });

    it('plays all of them in turn with a rest between, and stops when asked', () => {
        player.playAll();
        expect(tour[0]).toEqual(['lock', 0, EFFECTS.length]);
        expect(states.at(-1)).toEqual({ playing: 'lock', touring: true });
        vi.advanceTimersByTime(500 + TOUR_REST_MS);
        expect(tour[1]).toEqual(['hard-drop', 1, EFFECTS.length]);
        player.stop();
        const sent = emitted.length;
        vi.advanceTimersByTime(60000);
        expect(emitted).toHaveLength(sent);
        expect(states.at(-1)).toEqual({ playing: null, touring: false });
    });

    it('walks through every effect to the end, then rests', () => {
        player.playAll();
        vi.advanceTimersByTime(5 * 60 * 1000);
        expect(tour.map(([id]) => id)).toEqual(EFFECTS.map((effect) => effect.id));
        expect(player.touring).toBe(false);
        expect(player.playing).toBe(null);
    });

    it('lets one effect end Play all', () => {
        player.playAll();
        player.play('quad');
        vi.advanceTimersByTime(5 * 60 * 1000);
        expect(tour).toHaveLength(1);
        expect(states.at(-1)).toEqual({ playing: null, touring: false });
    });
});

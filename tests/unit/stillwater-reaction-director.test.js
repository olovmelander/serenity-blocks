import {
    describe, expect, it,
} from 'vitest';

import {
    STILLWATER_BEAT_CAPACITY,
    STILLWATER_CUE,
    STILLWATER_ROW_CAPACITY,
    STILLWATER_STREAM_CAPACITY,
    StillwaterReactionDirector,
} from '../../src/themes/stillwater/sim/stillwater-reaction-director.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import {
    emitHardDrop,
    emitLevelUp,
} from '../../src/events/gameplay-events.js';

function tPiece(overrides = {}) {
    return {
        type: 'T',
        x: 3,
        y: 17,
        shape: [
            [1, 1, 1],
            [0, 1, 0],
        ],
        ...overrides,
    };
}

function createSpySink() {
    const calls = [];
    let firstOptions = null;
    let reusedOptions = true;
    const record = (name) => (options, rows) => {
        if (firstOptions === null) firstOptions = options;
        else if (firstOptions !== options) reusedOptions = false;
        calls.push({
            name,
            options: { ...options },
            rows: rows ? Array.from(rows.subarray(0, options.rowCount)) : [],
        });
    };
    return {
        sink: {
            dimple: record('dimple'),
            wake: record('wake'),
            twist: record('twist'),
            echo: record('echo'),
            miracle: record('miracle'),
            spiritAttention: record('spiritAttention'),
            trollCue: record('trollCue'),
            tide: record('tide'),
            levelUp: record('levelUp'),
        },
        calls,
        of(name) {
            return calls.filter((call) => call.name === name);
        },
        reusedOptions() {
            return reusedOptions;
        },
    };
}

function createDirector(options = {}) {
    const spy = createSpySink();
    const director = new StillwaterReactionDirector({ sink: spy.sink, ...options });
    return { director, ...spy };
}

function advance(director, seconds, step = 1 / 120) {
    const steps = Math.round(seconds / step);
    for (let index = 0; index < steps; index += 1) director.update(step);
}

describe('StillwaterReactionDirector lock mapping', () => {
    it('uses the exact occupied-cell centroid for a sparse rotated piece', () => {
        const { director, of } = createDirector();
        director.onPieceLock({ piece: tPiece() });
        director.update(0);

        const [dimple] = of('dimple');
        expect(dimple.options.cue).toBe(STILLWATER_CUE.RUNE_DIMPLE);
        expect(dimple.options.boardX).toBeCloseTo(4.5);
        expect(dimple.options.boardY).toBeCloseTo(17.75);
        expect(dimple.options.originX).toBeCloseTo(0.45);
        expect(dimple.options.originY).toBeCloseTo(0.6875);
        expect(dimple.options.moteCount).toBe(4);
    });

    it('keeps the board centroid but lets Infinity viewportOrigin place the response', () => {
        const { director, of } = createDirector();
        director.onPieceLock({
            piece: tPiece({ y: 132 }),
            viewportOrigin: { x: 0.22, y: 0.31 },
        });
        director.update(0);

        const [dimple] = of('dimple');
        expect(dimple.options.boardX).toBeCloseTo(4.5);
        expect(dimple.options.boardY).toBeCloseTo(132.75);
        expect(dimple.options.originX).toBeCloseTo(0.22);
        expect(dimple.options.originY).toBeCloseTo(0.31);
    });

    it('falls back to the supplied piece cell when the shape has no occupied cells', () => {
        const { director, of } = createDirector();
        director.onPieceLock({ piece: tPiece({ x: 2, y: 5, shape: [[0, 0]] }) });
        director.update(0);
        expect(of('dimple')[0].options.boardX).toBeCloseTo(2.5);
        expect(of('dimple')[0].options.boardY).toBeCloseTo(5.5);
    });

    it('retains lock placement for a T-spin even when the routine lock ripple is disabled', () => {
        const { director, of } = createDirector({ pieceLockRipple: false });
        director.onPieceLock({ piece: tPiece() });
        director.onTSpin({ lineCount: 1 });
        director.update(0);

        expect(of('dimple')).toHaveLength(0);
        expect(of('twist')[0].options.originX).toBeCloseTo(0.45);
        expect(of('twist')[0].options.originY).toBeCloseTo(0.6875);
    });

    it('upgrades a co-resolving lock to one heavier hard-drop dimple and reed direction', () => {
        const { director, of } = createDirector();
        const payload = {
            piece: tPiece({ x: 1 }),
            startY: 2,
            endY: 17,
        };
        director.onHardDrop(payload);
        director.onPieceLock(payload);
        director.update(0);

        expect(of('dimple')).toHaveLength(1);
        expect(of('dimple')[0].options).toMatchObject({
            cue: STILLWATER_CUE.STONEFALL_DIMPLE,
            dropDistance: 15,
            direction: -1,
        });
        expect(of('dimple')[0].options.strength).toBeGreaterThan(0.34);
    });
});

describe('StillwaterReactionDirector coalescing and hierarchy', () => {
    function resolveInOrder(order) {
        const result = createDirector();
        for (let index = 0; index < order.length; index += 1) {
            if (order[index] === 'combo') {
                result.director.onCombo({ comboCount: 3 });
            } else {
                result.director.onLineClear({
                    lineCount: 1,
                    clearedRows: [18],
                    cascadeCount: 1,
                    comboCount: 3,
                });
            }
        }
        result.director.update(0);
        return result;
    }

    it('dedupes normal COMBO-before-LINE_CLEAR into one wake', () => {
        const result = resolveInOrder(['combo', 'line']);
        expect(result.of('wake')).toHaveLength(1);
        expect(result.of('dimple')).toHaveLength(0);
        expect(result.of('miracle')).toHaveLength(0);
    });

    it('dedupes Serenity LINE_CLEAR-before-COMBO into the same one wake', () => {
        const result = resolveInOrder(['line', 'combo']);
        expect(result.of('wake')).toHaveLength(1);
        expect(result.of('wake')[0].options.comboCount).toBe(3);
        expect(result.of('miracle')).toHaveLength(0);
    });

    it('launches no geometry for an unpaired combo event', () => {
        const { director, calls } = createDirector();
        director.onCombo({ comboCount: 5 });
        director.update(0);
        expect(calls.filter((call) => call.name !== 'tide')).toHaveLength(0);
    });

    it('uses rows, cascade depth, and alternating shore direction for a Tetris wake', () => {
        const { director, of } = createDirector();
        director.onLineClear({
            lineCount: 4,
            clearedRows: [16, 17, Number.NaN, 18, 19],
            cascadeCount: 2,
        });
        director.update(0);

        const [wake] = of('wake');
        expect(wake.rows).toEqual([16, 17, 18]);
        expect(wake.options.rowCount).toBe(3);
        expect(wake.options.cue).toBe(STILLWATER_CUE.LAKE_OPENS);
        expect(wake.options.cascadeCount).toBe(2);
        expect(wake.options.cascadeDepth).toBe(1);
        expect(wake.options.direction).toBe(1);
        expect(wake.options.specialPriority).toBe(1);
    });

    it('lets Infinity viewportOrigin place the line-clear wake', () => {
        const { director, of } = createDirector();
        director.onLineClear({
            lineCount: 2,
            clearedRows: [130, 131], // absolute Infinity rows would saturate originY to 1
            viewportOrigin: { x: 0.5, y: 0.28 },
        });
        director.update(0);
        const [wake] = of('wake');
        expect(wake.options.originX).toBeCloseTo(0.5);
        expect(wake.options.originY).toBeCloseTo(0.28);
        expect(wake.options.boardY).toBeGreaterThan(120); // raw mean row still absolute
    });

    it('lets T-spin upgrade the staged line and lock without generic duplicates', () => {
        const { director, of } = createDirector();
        director.onPieceLock({ piece: tPiece() });
        director.onLineClear({ lineCount: 2, clearedRows: [18, 19] });
        director.onTSpin({ lineCount: 2 });
        director.update(0);

        expect(of('twist')).toHaveLength(1);
        expect(of('wake')).toHaveLength(0);
        expect(of('dimple')).toHaveLength(0);
        expect(of('miracle')).toHaveLength(0);
    });

    it('gives perfect clear priority over combo apex, T-spin, Tetris, and lock', () => {
        const { director, of } = createDirector();
        director.onPieceLock({ piece: tPiece() });
        director.onCombo({ comboCount: 10 });
        director.onLineClear({ lineCount: 4, clearedRows: [16, 17, 18, 19] });
        director.onTSpin({ lineCount: 2 });
        director.onPerfectClear({ depth: 3 });
        director.update(0);

        expect(of('miracle')).toHaveLength(1);
        expect(of('miracle')[0].options.cue).toBe(STILLWATER_CUE.STILLWATER_AWAKENING);
        expect(of('wake')).toHaveLength(0);
        expect(of('twist')).toHaveLength(0);
        expect(of('dimple')).toHaveLength(0);
    });

    it('keeps slow level enrichment independent from the dominant lock response', () => {
        const { director, of } = createDirector();
        director.onPieceLock({ piece: tPiece() });
        director.onLevelUp({ level: 7 });
        director.update(0);

        expect(of('dimple')).toHaveLength(1);
        expect(of('levelUp')).toHaveLength(1);
        expect(of('levelUp')[0].options).toMatchObject({
            cue: STILLWATER_CUE.MOON_DEEPENS,
            level: 7,
            moteCount: 0,
        });
    });

    it('resolves combo 10 to one Forest Remembers miracle and one notice pair', () => {
        const { director, of } = createDirector();
        director.onCombo({ comboCount: 10 });
        director.onLineClear({ lineCount: 1, clearedRows: [18] });
        director.update(0);

        expect(of('miracle')).toHaveLength(1);
        expect(of('miracle')[0].options.cue).toBe(STILLWATER_CUE.FOREST_REMEMBERS);
        expect(of('wake')).toHaveLength(0);
        expect(of('spiritAttention')).toHaveLength(1);
        expect(of('trollCue')).toHaveLength(1);
    });
});

describe('StillwaterReactionDirector B2B theme-time echo', () => {
    it('copies the current special origin and emits one echo after 180 ms', () => {
        const { director, of } = createDirector();
        director.onPieceLock({ piece: tPiece() });
        director.onTSpin({ lineCount: 1 });
        director.onB2B({ active: true });
        director.update(0);

        expect(of('echo')).toHaveLength(0);

        director.onPieceLock({
            piece: tPiece({
                x: 0,
                shape: [[1, 1, 1, 1]],
            }),
        });
        director.update(0);
        advance(director, 0.17, 0.01);
        expect(of('echo')).toHaveLength(0);

        director.update(0.01);
        const [echo] = of('echo');
        expect(echo.options.originX).toBeCloseTo(0.45);
        expect(echo.options.echoOf).toBe(STILLWATER_CUE.NACKS_TURN);
        expect(echo.options.cue).toBe(STILLWATER_CUE.ECHO_ACROSS_MERE);
    });

    it('does not arm an echo when B2B has no current special', () => {
        const { director, of } = createDirector();
        director.onPieceLock({ piece: tPiece() });
        director.onB2B({ active: true });
        director.update(0);
        advance(director, 0.4);
        expect(of('echo')).toHaveLength(0);
    });

    it('holds delayed beats when update is not called', () => {
        const { director, of } = createDirector();
        director.onLineClear({ lineCount: 4, clearedRows: [16, 17, 18, 19] });
        director.onB2B({ active: true });
        director.update(0);
        expect(of('echo')).toHaveLength(0);
        expect(director.getDebugState().scheduledBeats).toBe(1);
    });
});

describe('StillwaterReactionDirector multiplayer and settings gates', () => {
    it('isolates local players and Odyssey levels in fixed stream records', () => {
        const { director, of } = createDirector();
        director.onLineClear({
            player: 1, source: 'local', lineCount: 1, clearedRows: [16],
        });
        director.onLineClear({
            player: 2, source: 'local', lineCount: 2, clearedRows: [17, 18],
        });
        director.onLineClear({
            player: 1, source: 'odyssey', levelId: 'lake-2', lineCount: 3, clearedRows: [19],
        });
        director.update(0);

        const wakes = of('wake');
        expect(wakes).toHaveLength(3);
        expect(wakes.map((call) => [
            call.options.source,
            call.options.levelId,
            call.options.player,
            call.options.lineCount,
        ])).toEqual([
            ['local', null, 1, 1],
            ['local', null, 2, 2],
            ['odyssey', 'lake-2', 1, 3],
        ]);
    });

    it('allows the production wrapper to reject remote/shared-board payloads', () => {
        const { director, of } = createDirector({
            acceptPayload: (payload) => payload.owner !== 'remote',
        });
        expect(director.onLineClear({
            owner: 'remote', player: 2, lineCount: 4, clearedRows: [16, 17, 18, 19],
        })).toBe(false);
        expect(director.onLineClear({
            owner: 'local', player: 1, lineCount: 1, clearedRows: [18],
        })).toBe(true);
        director.update(0);
        expect(of('wake')).toHaveLength(1);
        expect(of('wake')[0].options.player).toBe(1);
    });

    it('clears pending events and echoes when background effects are disabled', () => {
        const { director, calls } = createDirector();
        director.onLineClear({ lineCount: 4, clearedRows: [16, 17, 18, 19] });
        director.onB2B({ active: true });
        director.configure({ backgroundComboEffects: false });
        director.configure({ backgroundComboEffects: true });
        advance(director, 0.5);
        expect(calls).toHaveLength(0);
        expect(director.getDebugState().scheduledBeats).toBe(0);
    });

    it('cancels a staged routine dimple when pieceLockRipple is switched off', () => {
        const { director, of } = createDirector();
        director.onPieceLock({ piece: tPiece() });
        director.configure({ pieceLockRipple: false });
        director.update(0);
        expect(of('dimple')).toHaveLength(0);
    });

    it('writes a zero tide when the setting disables an already-active tide', () => {
        const { director, of } = createDirector();
        director.onCombo({ comboCount: 5 });
        director.onLineClear({ lineCount: 1, clearedRows: [18] });
        director.update(1 / 60);
        expect(of('tide').at(-1).options.strength).toBeGreaterThan(0);

        director.configure({ backgroundComboEffects: false });
        expect(of('tide').at(-1).options.strength).toBe(0);
        expect(director.getDebugState().enchantmentTide).toBe(0);
    });

    it('authors a stationary, shorter, lower-particle reduced-motion form', () => {
        const normal = createDirector();
        normal.director.onPieceLock({ piece: tPiece() });
        normal.director.update(0);

        const reduced = createDirector({ reducedMotion: true });
        reduced.director.onPieceLock({ piece: tPiece() });
        reduced.director.update(0);

        const normalCue = normal.of('dimple')[0].options;
        const reducedCue = reduced.of('dimple')[0].options;
        expect(normalCue.motionScale).toBe(1);
        expect(normalCue.durationMs).toBe(520);
        expect(normalCue.moteCount).toBe(4);
        expect(reducedCue.motionScale).toBe(0);
        expect(reducedCue.durationMs).toBe(220);
        expect(reducedCue.moteCount).toBe(0);
    });
});

describe('StillwaterReactionDirector fixed-time and fixed-capacity behavior', () => {
    function tideAfterOneSecond(hz) {
        const director = new StillwaterReactionDirector();
        director.onCombo({ comboCount: 5 });
        director.onLineClear({ lineCount: 1, clearedRows: [18] });
        director.update(0);
        for (let frame = 0; frame < hz; frame += 1) director.update(1 / hz);
        return director.getDebugState().enchantmentTide;
    }

    it('uses refresh-rate-independent half-life easing at 30, 60, and 144 Hz', () => {
        const at30 = tideAfterOneSecond(30);
        const at60 = tideAfterOneSecond(60);
        const at144 = tideAfterOneSecond(144);
        expect(at30).toBeCloseTo(at60, 8);
        expect(at60).toBeCloseTo(at144, 8);
        expect(at60).toBeGreaterThan(0.4);
        expect(at60).toBeLessThan(0.5);
    });

    it('clamps a long frame delta instead of advancing delayed effects by wall time', () => {
        const { director, of } = createDirector();
        director.onTSpin({ lineCount: 1 });
        director.onB2B({ active: true });
        director.update(10);
        expect(director.getDebugState().time).toBeCloseTo(0.1);
        expect(of('echo')).toHaveLength(0);
        director.update(0.08);
        expect(of('echo')).toHaveLength(0);
        director.update(0.1);
        expect(of('echo')).toHaveLength(1);
    });

    it('keeps five row buffers and the delayed-beat backing stores stable in a 10k storm', () => {
        const director = new StillwaterReactionDirector();
        const initial = director.getDebugState();
        const rows = initial.rowBuffers.slice();
        const { beatDue, beatSpecial } = initial;
        const lock = { piece: tPiece() };
        const tspin = { lineCount: 1 };
        const b2b = { active: true };

        for (let index = 0; index < 10000; index += 1) {
            director.onPieceLock(lock);
            director.onTSpin(tspin);
            director.onB2B(b2b);
            director.update(0);
        }

        const state = director.getDebugState();
        expect(state.rowBuffers).toHaveLength(STILLWATER_STREAM_CAPACITY);
        for (let index = 0; index < rows.length; index += 1) {
            expect(state.rowBuffers[index]).toBe(rows[index]);
            expect(state.rowBuffers[index]).toBeInstanceOf(Int16Array);
            expect(state.rowBuffers[index]).toHaveLength(STILLWATER_ROW_CAPACITY);
        }
        expect(state.beatDue).toBe(beatDue);
        expect(state.beatSpecial).toBe(beatSpecial);
        expect(state.scheduledBeats).toBe(STILLWATER_BEAT_CAPACITY);
        expect(state.droppedBeats).toBeGreaterThan(0);
        expect(Number.isFinite(state.enchantmentTide)).toBe(true);
    });

    it('reuses one mutable sink options record for every synchronous sink call', () => {
        const { director, reusedOptions } = createDirector();
        director.onCombo({ comboCount: 10 });
        director.onLineClear({ lineCount: 1, clearedRows: [18] });
        director.update(1 / 60);
        expect(reusedOptions()).toBe(true);
    });
});

describe('StillwaterReactionDirector lifecycle', () => {
    it('consumes canonical hard-drop and level-up emitters end to end', () => {
        const { director, of } = createDirector();
        director.attach(eventBus, EVENTS);
        try {
            emitHardDrop({
                piece: tPiece(),
                startY: 2,
                endY: 17,
            });
            emitLevelUp({ level: 6 });
            director.update(0);
            expect(of('dimple')[0].options.cue)
                .toBe(STILLWATER_CUE.STONEFALL_DIMPLE);
            expect(of('levelUp')[0].options.level).toBe(6);
        } finally {
            director.dispose();
        }
    });

    it('attaches all eight canonical events defensively and detaches idempotently', () => {
        const subscriptions = [];
        let unsubscribeCount = 0;
        const bus = {
            on(name, handler) {
                subscriptions.push({ name, handler });
                return () => { unsubscribeCount += 1; };
            },
        };
        const events = {
            PIECE_LOCK: 'pieceLock',
            LINE_CLEAR: 'lineClear',
            COMBO: 'combo',
            TSPIN: 'tspin',
            B2B: 'b2b',
            PERFECT_CLEAR: 'perfectClear',
            CASCADE: 'cascade',
            HARD_DROP: 'hardDrop',
            LEVEL_UP: 'levelUp',
        };
        const director = new StillwaterReactionDirector();
        const detach = director.attach(bus, events);

        expect(subscriptions.map((entry) => entry.name)).toEqual([
            'pieceLock',
            'lineClear',
            'combo',
            'tspin',
            'b2b',
            'perfectClear',
            'hardDrop',
            'levelUp',
        ]);
        expect(subscriptions.map((entry) => entry.name)).not.toContain('cascade');

        detach();
        director.detach();
        expect(unsubscribeCount).toBe(8);
    });

    it('still attaches to older six-event harnesses without undefined subscriptions', () => {
        const subscriptions = [];
        const bus = {
            on(name) {
                subscriptions.push(name);
                return () => {};
            },
        };
        const director = new StillwaterReactionDirector();
        director.attach(bus, {
            PIECE_LOCK: 'pieceLock',
            LINE_CLEAR: 'lineClear',
            COMBO: 'combo',
            TSPIN: 'tspin',
            B2B: 'b2b',
            PERFECT_CLEAR: 'perfectClear',
        });
        expect(subscriptions).toHaveLength(6);
    });

    it('reset clears state and dispose permanently suppresses output', () => {
        const { director, calls } = createDirector();
        director.onCombo({ comboCount: 8 });
        director.onLineClear({ lineCount: 4, clearedRows: [16, 17, 18, 19] });
        director.onB2B({ active: true });
        director.update(0);
        expect(calls.length).toBeGreaterThan(0);

        director.reset();
        expect(director.getDebugState()).toMatchObject({
            time: 0,
            enchantmentTide: 0,
            activeStreams: 0,
            pendingStreams: 0,
            scheduledBeats: 0,
        });

        const beforeDispose = calls.length;
        director.dispose();
        director.dispose();
        expect(director.onPieceLock({ piece: tPiece() })).toBe(false);
        director.update(1);
        expect(calls).toHaveLength(beforeDispose);
        expect(director.getDebugState().disposed).toBe(true);
    });
});

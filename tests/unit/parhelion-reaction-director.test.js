import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

import {
    CUE,
    PARHELION_APEX_COOLDOWN,
    PARHELION_ECHO_CAPACITY,
    PARHELION_ECHO_DELAY,
    PARHELION_EVENT_HANDLERS,
    PARHELION_PLAYER_SLOTS,
    ReactionDirector,
} from '../../src/themes/parhelion/sim/parhelion-reaction-director.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import {
    emitHardDrop,
    emitLevelUp,
    emitLineClear,
    emitPieceLock,
} from '../../src/events/gameplay-events.js';

// T piece at x 3, y 17: occupied cells (3,17) (4,17) (5,17) (4,18) → centroid (4.5, 17.75)
// → board-normalised u 0.45, v (17.75 - 4) / 20 = 0.6875.
const T_LOCK_U = 0.45;
const T_LOCK_V = 0.6875;

function tPiece(overrides = {}) {
    return {
        shapeKey: 'T',
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
    const cues = [];
    const log = [];
    const resonances = [];
    const levels = [];
    const counts = [];
    let firstCue = null;
    let reused = true;
    return {
        sink: {
            cue(c) {
                if (firstCue === null) firstCue = c;
                else if (firstCue !== c) reused = false;
                cues.push({ ...c });
                log.push(`cue:${c.kind}`);
            },
            resonance(r) {
                resonances.push(r);
            },
            levelUp(n) {
                levels.push(n);
                log.push(`level:${n}`);
            },
            count(n) {
                counts.push(n);
                log.push(`count:${n}`);
            },
        },
        cues,
        log,
        resonances,
        levels,
        counts,
        kinds() {
            return cues.map((c) => c.kind);
        },
        last() {
            return cues[cues.length - 1];
        },
        reusedCue() {
            return reused;
        },
        firstCue() {
            return firstCue;
        },
    };
}

function createDirector(options = {}) {
    const spy = createSpySink();
    const director = new ReactionDirector({ sink: spy.sink, ...options });
    return { director, ...spy };
}

function advance(director, seconds, step = 0.01) {
    const steps = Math.round(seconds / step);
    for (let index = 0; index < steps; index += 1) director.update(step);
}

function quietLock(director, extra = {}) {
    director.onPieceLock({ piece: tPiece(), ...extra });
}

function clearingLock(director, extra = {}, lineCount = 1) {
    director.onPieceLock({ piece: tPiece(), ...extra });
    director.onLineClear({ lineCount, clearedRows: [23], ...extra });
}

/** n consecutive clearing locks, one resolution (0.1 s) each → true combo n. */
function buildCombo(director, n, extra = {}) {
    for (let index = 0; index < n; index += 1) {
        clearingLock(director, extra);
        director.update(0.1);
    }
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Parhelion ReactionDirector dominance', () => {
    it('orders the cue kinds PERFECT > APEX > TSPIN > QUAD > CLEAR > STONEFALL > LOCK', () => {
        expect(CUE.PERFECT).toBeGreaterThan(CUE.APEX);
        expect(CUE.APEX).toBeGreaterThan(CUE.TSPIN);
        expect(CUE.TSPIN).toBeGreaterThan(CUE.QUAD);
        expect(CUE.QUAD).toBeGreaterThan(CUE.CLEAR);
        expect(CUE.CLEAR).toBeGreaterThan(CUE.STONEFALL);
        expect(CUE.STONEFALL).toBeGreaterThan(CUE.LOCK);
        expect(CUE.LOCK).toBeGreaterThan(CUE.NONE);
        expect(Object.keys(CUE)).toEqual([
            'NONE', 'LOCK', 'STONEFALL', 'CLEAR', 'QUAD', 'TSPIN', 'APEX', 'PERFECT', 'ECHO',
        ]);
    });

    const ladder = [
        ['a plain lock', CUE.LOCK, (d) => {
            d.onPieceLock({ piece: tPiece() });
        }],
        ['a hard drop over its lock', CUE.STONEFALL, (d) => {
            d.onHardDrop({ piece: tPiece(), distance: 12 });
            d.onPieceLock({ piece: tPiece() });
        }],
        ['a clear over a hard drop', CUE.CLEAR, (d) => {
            d.onHardDrop({ piece: tPiece(), distance: 12 });
            d.onPieceLock({ piece: tPiece() });
            d.onLineClear({ lineCount: 3, clearedRows: [21, 22, 23] });
        }],
        ['a four-line clear over a clear', CUE.QUAD, (d) => {
            d.onPieceLock({ piece: tPiece() });
            d.onLineClear({ lineCount: 4, clearedRows: [20, 21, 22, 23] });
        }],
        ['a T-spin over a four-line clear', CUE.TSPIN, (d) => {
            d.onPieceLock({ piece: tPiece() });
            d.onLineClear({ lineCount: 4, clearedRows: [20, 21, 22, 23] });
            d.onTSpin({ lineCount: 2 });
        }],
        ['a combo-10 apex over a T-spin', CUE.APEX, (d) => {
            d.onPieceLock({ piece: tPiece() });
            d.onLineClear({ lineCount: 2, clearedRows: [22, 23], comboCount: 10 });
            d.onTSpin({ lineCount: 2 });
        }],
        ['a perfect clear over everything', CUE.PERFECT, (d) => {
            d.onHardDrop({ piece: tPiece(), distance: 12 });
            d.onPieceLock({ piece: tPiece() });
            d.onCombo({ comboCount: 3 });
            d.onLineClear({ lineCount: 4, clearedRows: [20, 21, 22, 23], comboCount: 10 });
            d.onTSpin({ lineCount: 2 });
            d.onB2B({ active: true });
            d.onPerfectClear({ depth: 4 });
        }],
    ];

    it.each(ladder)('resolves %s to exactly one dominant cue', (_label, expected, stage) => {
        const { director, kinds } = createDirector();
        stage(director);
        director.update(1 / 60);
        expect(kinds()).toEqual([expected]);
        advance(director, 0.5);
        expect(kinds()).toEqual([expected]); // nothing trails the resolution (no echo without b2b)
    });

    it('treats COMBO.comboCount as cascade depth: a strength modifier, never an apex', () => {
        const { director, cues } = createDirector();
        director.onPieceLock({ piece: tPiece() });
        director.onCombo({ comboCount: 10 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 2 });
        director.update(0);

        expect(cues).toHaveLength(1);
        expect(cues[0]).toMatchObject({
            kind: CUE.CLEAR, combo: 1, depth: 10, cascade: 2, lines: 1,
        });
        expect(cues[0].strength).toBeCloseTo(1.15); // +0.05 * min(3, depth)
    });

    it('lets an explicit LINE_CLEAR comboCount (Odyssey victory lap) reach the apex', () => {
        const { director, kinds, last } = createDirector();
        director.onCombo({ comboCount: 10 });
        director.onLineClear({ lineCount: 4, comboCount: 10 });
        director.update(0);
        expect(kinds()).toEqual([CUE.APEX]);
        expect(last().combo).toBe(10);
    });

    it('never emits a cue for a bare COMBO, B2B or LEVEL_UP', () => {
        const { director, cues, levels } = createDirector();
        director.onCombo({ comboCount: 4 });
        director.update(0.01);
        director.onB2B({ active: true });
        director.update(0.01);
        director.onLevelUp({ level: 7 });
        director.update(0.01);
        advance(director, 0.5);
        expect(cues).toHaveLength(0);
        expect(levels).toEqual([7]);
    });

    it('keeps LEVEL_UP independent of the dominant cue and after it', () => {
        const { director, kinds, log } = createDirector();
        quietLock(director);
        director.onLevelUp({ level: 6 });
        director.update(0);
        expect(kinds()).toEqual([CUE.LOCK]);
        expect(log).toEqual([`cue:${CUE.LOCK}`, 'level:6']);
    });

    it('scales hard-drop strength with distance and keeps a full drop at the nominal beat', () => {
        const { director, cues } = createDirector();
        director.onHardDrop({ piece: tPiece(), distance: 0 });
        director.onPieceLock({ piece: tPiece() });
        director.update(0.01);
        director.onHardDrop({ piece: tPiece(), distance: 40 });
        director.onPieceLock({ piece: tPiece() });
        director.update(0.01);
        expect(cues.map((c) => c.kind)).toEqual([CUE.STONEFALL, CUE.STONEFALL]);
        expect(cues[0].strength).toBeCloseTo(0.4 / 0.65);
        expect(cues[1].strength).toBeCloseTo(1);
        expect(cues[0].lines).toBe(0);
    });
});

describe('Parhelion ReactionDirector origins', () => {
    it('uses the occupied-cell centroid for a lock and anchors rowV to it', () => {
        const { director, last } = createDirector();
        quietLock(director);
        director.update(0);
        expect(last().kind).toBe(CUE.LOCK);
        expect(last().lockU).toBeCloseTo(T_LOCK_U);
        expect(last().lockV).toBeCloseTo(T_LOCK_V);
        expect(last().rowV).toBeCloseTo(T_LOCK_V);
        expect(last().sx).toBe(-1);
        expect(last().sy).toBe(-1);
    });

    it('lets an Infinity viewportOrigin win over absolute piece rows for the lock', () => {
        const { director, last } = createDirector();
        director.onPieceLock({
            piece: tPiece({ y: 132 }), // absolute Infinity row: board math would pin to v = 1
            viewportOrigin: { x: 0.22, y: 0.31 },
        });
        director.update(0);
        expect(last().lockU).toBeCloseTo(0.22);
        expect(last().lockV).toBeCloseTo(0.31);
        expect(last().sx).toBe(-1); // board-normalised, not screen space
    });

    it('lets an Infinity viewportOrigin win over absolute clearedRows for the clear row', () => {
        const { director, last } = createDirector();
        director.onPieceLock({ piece: tPiece({ y: 129 }), viewportOrigin: { x: 0.7, y: 0.26 } });
        director.onLineClear({
            lineCount: 2,
            clearedRows: [130, 131],
            viewportOrigin: { x: 0.5, y: 0.28 },
        });
        director.update(0);
        expect(last().kind).toBe(CUE.CLEAR);
        expect(last().rowV).toBeCloseTo(0.28);
        expect(last().lockU).toBeCloseTo(0.7);
        expect(last().sx).toBe(-1);
    });

    it('climbs a clear from the cleared-row mean and keeps the lock side', () => {
        const { director, last } = createDirector();
        director.onPieceLock({ piece: tPiece() });
        director.onLineClear({ lineCount: 2, clearedRows: [22, 23] });
        director.update(0);
        expect(last().rowV).toBeCloseTo((22.5 + 0.5 - 4) / 20);
        expect(last().lockU).toBeCloseTo(T_LOCK_U);
    });

    it('anchors a T-spin at the lock origin, not the cleared rows', () => {
        const { director, cues } = createDirector();
        director.onPieceLock({ piece: tPiece() });
        director.onLineClear({ lineCount: 2, clearedRows: [22, 23] });
        director.onTSpin({ lineCount: 2 });
        director.update(0);
        expect(cues).toHaveLength(1);
        expect(cues[0]).toMatchObject({ kind: CUE.TSPIN, lines: 2 });
        expect(cues[0].lockU).toBeCloseTo(T_LOCK_U);
        expect(cues[0].rowV).toBeCloseTo(T_LOCK_V);
        expect(cues[0].rowV).not.toBeCloseTo(0.95);
    });

    it('passes a Serenity click position through as screen space normalised by the window', () => {
        vi.stubGlobal('window', { innerWidth: 1600, innerHeight: 900 });
        const { director, cues } = createDirector();
        const click = { source: 'serenity-interaction', position: { x: 400, y: 450 } };
        director.onLineClear({
            lineCount: 2, clearedRows: [], comboCount: 3, ...click,
        });
        director.onCombo({ comboCount: 3, ...click });
        director.update(0);

        expect(cues).toHaveLength(1);
        expect(cues[0]).toMatchObject({
            kind: CUE.CLEAR, combo: 3, depth: 0, lines: 2,
        });
        expect(cues[0].sx).toBeCloseTo(0.25);
        expect(cues[0].sy).toBeCloseTo(0.5);
    });

    it('prefers an explicit viewport size and reports no screen origin without one', () => {
        const withViewport = createDirector();
        withViewport.director.setViewport(800, 600);
        withViewport.director.onLineClear({ lineCount: 1, position: { x: 200, y: 450 } });
        withViewport.director.update(0);
        expect(withViewport.last().sx).toBeCloseTo(0.25);
        expect(withViewport.last().sy).toBeCloseTo(0.75);

        const headless = createDirector(); // node: no window, no viewport
        headless.director.onLineClear({ lineCount: 1, position: { x: 200, y: 450 } });
        headless.director.update(0);
        expect(headless.last().sx).toBe(-1);
        expect(headless.last().sy).toBe(-1);
    });
});

describe('Parhelion ReactionDirector per-player isolation', () => {
    it('keeps combos, cues and origins apart for local-MP boards in one frame', () => {
        const { director, cues } = createDirector();
        buildCombo(director, 2, { player: 1 });
        cues.length = 0;

        clearingLock(director, { player: 1 });
        director.onPieceLock({ piece: tPiece({ x: 0 }), player: 2 });
        director.onPieceLock({ piece: tPiece({ x: 7 }), player: 3 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], player: 3 });
        director.update(0.1);

        expect(cues.map((c) => [c.player, c.kind, c.combo])).toEqual([
            [1, CUE.CLEAR, 3],
            [2, CUE.LOCK, 0],
            [3, CUE.CLEAR, 1],
        ]);
        expect(cues[1].lockU).toBeCloseTo(0.15);
        expect(cues[2].lockU).toBeCloseTo(0.85);
        expect(cues.map((c) => c.primary)).toEqual([true, false, false]);
    });

    it('keys slots by player only, so Infinity source tags cannot split one lock', () => {
        const { director, kinds } = createDirector();
        director.onPieceLock({ piece: tPiece() });
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.onTSpin({ lineCount: 1, source: 'infinity' });
        director.onB2B({ active: true, source: 'infinity' });
        director.update(0);
        expect(kinds()).toEqual([CUE.TSPIN]);
    });

    it('bounds concurrent players to five fixed slots and drops the overflow', () => {
        const { director, cues } = createDirector();
        for (let player = 0; player < 7; player += 1) {
            director.onPieceLock({ piece: tPiece(), player });
        }
        director.update(0);
        expect(cues).toHaveLength(PARHELION_PLAYER_SLOTS);
        const state = director.getDebugState();
        expect(state.slotCount).toBe(PARHELION_PLAYER_SLOTS);
        expect(state.droppedEvents).toBe(2);
    });
});

describe('Parhelion ReactionDirector B2B echo', () => {
    it('answers a B2B four-line clear once, 0.18 s later, at half strength', () => {
        const { director, cues } = createDirector({ intensity: 0.8 });
        director.onPieceLock({ piece: tPiece() });
        director.onLineClear({ lineCount: 4, clearedRows: [20, 21, 22, 23] });
        director.onB2B({ active: true });
        director.update(0);

        expect(cues).toHaveLength(1);
        expect(cues[0]).toMatchObject({ kind: CUE.QUAD, b2b: true });
        const quad = cues[0];

        // A later lock elsewhere must not move the in-flight echo (copied by value).
        director.onPieceLock({ piece: tPiece({ x: 0, y: 5 }) });
        director.update(0);
        advance(director, 0.17);
        expect(cues.map((c) => c.kind)).toEqual([CUE.QUAD, CUE.LOCK]);

        advance(director, PARHELION_ECHO_DELAY - 0.17);
        expect(cues.map((c) => c.kind)).toEqual([CUE.QUAD, CUE.LOCK, CUE.ECHO]);
        const echo = cues[2];
        expect(echo.echoOf).toBe(CUE.QUAD);
        expect(echo.strength).toBeCloseTo(quad.strength * 0.5);
        expect(echo.strength).toBeCloseTo(0.4);
        expect(echo.rowV).toBeCloseTo(quad.rowV);
        expect(echo.lockU).toBeCloseTo(quad.lockU);
        expect(echo.b2b).toBe(false);

        advance(director, 1);
        expect(cues).toHaveLength(3);
    });

    it('echoes a B2B T-spin and a B2B apex', () => {
        const tspin = createDirector();
        tspin.director.onPieceLock({ piece: tPiece() });
        tspin.director.onLineClear({ lineCount: 2, clearedRows: [22, 23] });
        tspin.director.onTSpin({ lineCount: 2 });
        tspin.director.onB2B({ active: true });
        tspin.director.update(0);
        advance(tspin.director, 0.2);
        expect(tspin.kinds()).toEqual([CUE.TSPIN, CUE.ECHO]);
        expect(tspin.last().echoOf).toBe(CUE.TSPIN);
        expect(tspin.last().rowV).toBeCloseTo(T_LOCK_V);

        const apex = createDirector();
        apex.director.onLineClear({ lineCount: 4, comboCount: 10 });
        apex.director.onB2B({ active: true });
        apex.director.update(0);
        advance(apex.director, 0.2);
        expect(apex.kinds()).toEqual([CUE.APEX, CUE.ECHO]);
        expect(apex.last().echoOf).toBe(CUE.APEX);
    });

    it('never fires an echo alone or after an ordinary clear or lock', () => {
        const { director, kinds } = createDirector();
        director.onB2B({ active: true });
        director.update(0.01);
        quietLock(director);
        director.onB2B({ active: true });
        director.update(0.01);
        clearingLock(director, {}, 2);
        director.onB2B({ active: true });
        director.update(0.01);
        advance(director, 0.5);
        expect(kinds()).toEqual([CUE.LOCK, CUE.CLEAR]);
        expect(director.getDebugState().echoCount).toBe(0);
    });
});

describe('Parhelion ReactionDirector apex cooldown', () => {
    it('fires the apex at true combo 10 and holds it off for 6 s per player', () => {
        const { director, kinds, cues } = createDirector();
        buildCombo(director, 10);
        expect(kinds().slice(0, 9).every((kind) => kind === CUE.CLEAR)).toBe(true);
        expect(cues[9]).toMatchObject({ kind: CUE.APEX, combo: 10 });

        buildCombo(director, 1); // combo 11, 0.1 s later
        expect(cues[10]).toMatchObject({ kind: CUE.CLEAR, combo: 11 });

        advance(director, PARHELION_APEX_COOLDOWN - 1.2, 0.1); // still inside the cooldown
        buildCombo(director, 1);
        expect(cues[11]).toMatchObject({ kind: CUE.CLEAR, combo: 12 });

        advance(director, 1.2, 0.1); // now past 6 s since the apex
        buildCombo(director, 1);
        expect(cues[12]).toMatchObject({ kind: CUE.APEX, combo: 13 });
    });

    it('keeps each player on their own cooldown', () => {
        const { director, cues } = createDirector();
        buildCombo(director, 10, { player: 1 });
        buildCombo(director, 10, { player: 2 });
        const apexes = cues.filter((c) => c.kind === CUE.APEX);
        expect(apexes.map((c) => c.player)).toEqual([1, 2]);
    });

    it('does not let a cascade depth of 10 impersonate the apex', () => {
        const { director, kinds } = createDirector();
        director.onPieceLock({ piece: tPiece() });
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.update(0.1);
        director.onCombo({ comboCount: 10 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 10 });
        director.update(0.1);
        expect(kinds()).toEqual([CUE.CLEAR, CUE.CLEAR]);
    });
});

describe('Parhelion ReactionDirector resonance', () => {
    it('rises with a 0.28 s half-life, holds 1.65 s, then falls with a 0.85 s half-life', () => {
        const { director, resonances } = createDirector();
        director.onLineClear({ lineCount: 1, comboCount: 10, position: { x: 1, y: 1 } });
        director.update(0);
        expect(director.getDebugState().resonanceTarget).toBe(1);
        expect(director.getDebugState().resonance).toBe(0); // a zero delta never eases

        advance(director, 0.28);
        expect(director.getDebugState().resonanceTarget).toBe(1);
        expect(director.getDebugState().resonance).toBeCloseTo(0.5, 3);

        advance(director, 1.3); // 1.58 s: still holding the chain's target
        expect(director.getDebugState().resonanceTarget).toBe(1);
        const peak = director.getDebugState().resonance;
        expect(peak).toBeGreaterThan(0.97);

        advance(director, 0.07 + 0.85); // hold over at 1.65 s, then one fall half-life
        expect(director.getDebugState().resonanceTarget).toBe(0);
        expect(director.getDebugState().resonance).toBeCloseTo(peak / 2, 1);

        advance(director, 20, 0.05);
        expect(director.getDebugState().resonance).toBe(0);
        expect(resonances[resonances.length - 1]).toBe(0);
    });

    it('maps the true combo linearly: r = clamp(combo / 10)', () => {
        const { director } = createDirector();
        buildCombo(director, 4);
        expect(director.getDebugState().resonanceTarget).toBeCloseTo(0.4);
        buildCombo(director, 12);
        expect(director.getDebugState().resonanceTarget).toBe(1);
    });

    it('is independent of the frame rate', () => {
        function after(hz) {
            const director = new ReactionDirector();
            director.onLineClear({ lineCount: 1, comboCount: 7, position: { x: 1, y: 1 } });
            director.update(0);
            for (let frame = 0; frame < hz; frame += 1) director.update(1 / hz);
            return director.getDebugState().resonance;
        }
        expect(after(30)).toBeCloseTo(after(60), 8);
        expect(after(60)).toBeCloseTo(after(144), 8);
    });
});

describe('Parhelion ReactionDirector lock count and Full Circle', () => {
    it('counts primary locks only, even when a clear dominates, and defers the Full Circle', () => {
        const { director, cues, counts } = createDirector();
        for (let index = 0; index < 11; index += 1) {
            quietLock(director);
            director.onPieceLock({ piece: tPiece(), player: 2 }); // secondary board: not counted
            director.update(0.1);
        }
        const primaryLocks = cues.filter((c) => c.player === 0);
        expect(primaryLocks.map((c) => c.lockCount)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        expect(cues.filter((c) => c.player === 2).every((c) => !c.primary)).toBe(true);
        expect(counts).toEqual([]);

        clearingLock(director); // the 12th lock clears: the CLEAR owns the resolution
        director.update(0.1);
        expect(cues[cues.length - 1]).toMatchObject({ kind: CUE.CLEAR, lockCount: 12 });
        expect(counts).toEqual([]);

        quietLock(director); // next quiet lock carries the deferred Full Circle
        director.update(0.1);
        expect(cues[cues.length - 1]).toMatchObject({ kind: CUE.LOCK, lockCount: 13 });
        expect(counts).toEqual([13]);
        expect(director.getDebugState().fullCirclePending).toBe(false);
    });

    it('fires the Full Circle on the 12th quiet lock right after its station cue', () => {
        const { director, log, counts } = createDirector();
        for (let index = 0; index < 24; index += 1) {
            quietLock(director, { player: 1 }); // local-MP board 1 is the primary board
            director.update(0.1);
        }
        expect(counts).toEqual([12, 24]);
        const at = log.indexOf('count:12');
        expect(log[at - 1]).toBe(`cue:${CUE.LOCK}`);
    });

    it('keeps counting but shows no stations or Full Circle when lock ripple is off', () => {
        const { director, cues, counts } = createDirector({ lockRipple: false });
        for (let index = 0; index < 12; index += 1) {
            quietLock(director);
            director.update(0.1);
        }
        expect(cues).toHaveLength(0);
        expect(counts).toEqual([]);
        expect(director.getDebugState().lockCount).toBe(12);

        director.onPieceLock({ piece: tPiece() }); // a T-spin still finds its lock origin
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.onTSpin({ lineCount: 1 });
        director.update(0.1);
        expect(cues[0].kind).toBe(CUE.TSPIN);
        expect(cues[0].rowV).toBeCloseTo(T_LOCK_V);
    });

    it('cancels a staged lock cue when lock ripple is switched off mid-frame', () => {
        const { director, cues } = createDirector();
        quietLock(director);
        director.configure({ lockRipple: false });
        director.update(0);
        expect(cues).toHaveLength(0);
    });
});

describe('Parhelion ReactionDirector fixed capacity', () => {
    it('reuses one cue object and a bounded echo ring through a 10k storm', () => {
        const { director, cues, reusedCue } = createDirector();
        const initial = director.getDebugState();
        const { cue, echoDue, echoKind } = initial;
        const lock = { piece: tPiece() };
        const clear = { lineCount: 2, clearedRows: [22, 23] };
        const tspin = { lineCount: 2 };
        const b2b = { active: true };

        for (let index = 0; index < 10000; index += 1) {
            director.onPieceLock(lock);
            director.onLineClear(clear);
            director.onTSpin(tspin);
            director.onB2B(b2b);
            director.update(0);
        }

        const state = director.getDebugState();
        expect(cues).toHaveLength(10000); // exactly one cue per resolution
        expect(state.cue).toBe(cue);
        expect(state.echoDue).toBe(echoDue);
        expect(state.echoKind).toBe(echoKind);
        expect(state.echoCount).toBe(PARHELION_ECHO_CAPACITY);
        expect(state.droppedEchoes).toBe(10000 - PARHELION_ECHO_CAPACITY);
        expect(state.slotCount).toBe(PARHELION_PLAYER_SLOTS);
        expect(state.assignedSlots).toBe(1);

        advance(director, 0.2);
        expect(cues.filter((c) => c.kind === CUE.ECHO)).toHaveLength(PARHELION_ECHO_CAPACITY);
        expect(reusedCue()).toBe(true);
        expect(director.getDebugState().echoCount).toBe(0);
    });

    it('stays bounded when many player ids churn through the slots', () => {
        const { director } = createDirector();
        for (let index = 0; index < 5000; index += 1) {
            director.onPieceLock({ piece: tPiece(), player: index % 11 });
            if (index % 3 === 0) director.update(0.01);
        }
        director.update(0.01);
        const state = director.getDebugState();
        expect(state.slotCount).toBe(PARHELION_PLAYER_SLOTS);
        expect(state.assignedSlots).toBeLessThanOrEqual(PARHELION_PLAYER_SLOTS);
        expect(state.pendingSlots).toBe(0);
    });

    it('survives a throwing sink without stalling echoes', () => {
        let calls = 0;
        const director = new ReactionDirector({
            sink: {
                cue() {
                    calls += 1;
                    throw new Error('sink failure');
                },
            },
        });
        director.onLineClear({ lineCount: 4, clearedRows: [20, 21, 22, 23] });
        director.onB2B({ active: true });
        director.update(0);
        advance(director, 0.2);
        expect(calls).toBe(2);
        expect(director.getDebugState().sinkErrors).toBe(2);
    });
});

describe('Parhelion ReactionDirector settings and resets', () => {
    function primeActiveState(director) {
        buildCombo(director, 3);
        director.onPieceLock({ piece: tPiece() });
        director.onLineClear({ lineCount: 4, clearedRows: [20, 21, 22, 23] });
        director.onB2B({ active: true });
        director.update(0.02);
        director.onPieceLock({ piece: tPiece() }); // staged, not yet resolved
    }

    it('resets everything at intensity 0 and replays nothing when re-enabled', () => {
        const {
            director, cues, resonances,
        } = createDirector();
        primeActiveState(director);
        const before = director.getDebugState();
        expect(before.echoCount).toBe(1);
        expect(before.lockCount).toBe(4);
        expect(before.resonance).toBeGreaterThan(0);
        const emitted = cues.length;

        director.configure({ intensity: 0 });
        const state = director.getDebugState();
        expect(state).toMatchObject({
            time: 0,
            lockCount: 0,
            echoCount: 0,
            resonance: 0,
            assignedSlots: 0,
            pendingSlots: 0,
        });
        expect(resonances[resonances.length - 1]).toBe(0);
        expect(director.onPieceLock({ piece: tPiece() })).toBe(false);
        expect(director.onLineClear({ lineCount: 4 })).toBe(false);

        director.configure({ intensity: 1 });
        advance(director, 0.5);
        expect(cues).toHaveLength(emitted); // no stale echo, no stale lock

        buildCombo(director, 1);
        expect(cues[cues.length - 1]).toMatchObject({ kind: CUE.CLEAR, combo: 1, lockCount: 1 });
    });

    it('reset() (gameOver / modeStopped) clears chains but keeps the settings', () => {
        const { director, cues } = createDirector({ intensity: 0.7 });
        primeActiveState(director);
        director.reset();
        expect(director.getDebugState()).toMatchObject({
            lockCount: 0, echoCount: 0, resonance: 0, intensity: 0.7,
        });
        const emitted = cues.length;
        advance(director, 0.5);
        expect(cues).toHaveLength(emitted);
        expect(director.onPieceLock({ piece: tPiece() })).toBe(true);
    });

    it('caps strength at 0.45 and flags the cue under reduced motion', () => {
        const { director, last } = createDirector({ reducedMotion: true, intensity: 1 });
        director.onLineClear({ lineCount: 4, clearedRows: [20, 21, 22, 23] });
        director.update(0);
        expect(last()).toMatchObject({ kind: CUE.QUAD, reducedMotion: true });
        expect(last().strength).toBeCloseTo(0.45);

        director.configure({ reducedMotion: false, intensity: 0.6 });
        quietLock(director);
        director.update(0.01);
        expect(last()).toMatchObject({ kind: CUE.LOCK, reducedMotion: false });
        expect(last().strength).toBeCloseTo(0.6);
    });

    it('tolerates null payloads and derives a raw hard-drop distance from its rows', () => {
        const { director, cues } = createDirector();
        expect(director.onPieceLock(null)).toBe(true);
        expect(director.onLineClear(null)).toBe(true);
        director.update(0.01);
        expect(cues[0]).toMatchObject({ kind: CUE.CLEAR, lines: 1, player: 0 });

        director.onHardDrop({ piece: tPiece(), startY: 0, endY: 18 });
        director.onPieceLock({ piece: tPiece() });
        director.update(0.01);
        expect(cues[1].kind).toBe(CUE.STONEFALL);
        expect(cues[1].strength).toBeCloseTo(1);
    });

    it('reports the carried combo on a quiet lock, not a stale clear combo', () => {
        const { director, last } = createDirector();
        buildCombo(director, 3);
        quietLock(director); // chain still unresolved: carries 3
        director.update(0.1);
        expect(last()).toMatchObject({ kind: CUE.LOCK, combo: 3 });
        quietLock(director); // the previous lock cleared nothing: chain broken
        director.update(0.1);
        expect(last()).toMatchObject({ kind: CUE.LOCK, combo: 0 });
    });

    it('suppresses all output once disposed', () => {
        const { director, cues } = createDirector();
        director.dispose();
        director.dispose();
        expect(director.onPieceLock({ piece: tPiece() })).toBe(false);
        director.update(1);
        expect(cues).toHaveLength(0);
    });
});

describe('Parhelion ReactionDirector canonical payloads', () => {
    it('maps every canonical event key to a live handler', () => {
        const director = new ReactionDirector();
        const keys = Object.keys(PARHELION_EVENT_HANDLERS);
        expect(keys).toHaveLength(8);
        keys.forEach((key) => {
            expect(typeof EVENTS[key]).toBe('string');
            expect(typeof director[PARHELION_EVENT_HANDLERS[key]]).toBe('function');
        });
    });

    it('consumes the real emitters end to end through the bus', () => {
        const { director, cues, levels } = createDirector();
        const unsubscribers = Object.keys(PARHELION_EVENT_HANDLERS).map((key) => eventBus.on(
            EVENTS[key],
            (payload) => director[PARHELION_EVENT_HANDLERS[key]](payload),
        ));
        try {
            const piece = tPiece();
            emitHardDrop({ piece, startY: 2, endY: 17 });
            emitPieceLock({ piece });
            director.update(0.01);
            emitPieceLock({ piece });
            emitLevelUp({ level: 3 });
            emitLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            director.update(0.01);
        } finally {
            unsubscribers.forEach((unsubscribe) => unsubscribe());
        }
        expect(cues.map((c) => c.kind)).toEqual([CUE.STONEFALL, CUE.CLEAR]);
        expect(cues[0].strength).toBeCloseTo((0.4 + 0.25 * (15 / 18)) / 0.65);
        expect(cues[1].lockCount).toBe(2);
        expect(levels).toEqual([3]);
    });
});

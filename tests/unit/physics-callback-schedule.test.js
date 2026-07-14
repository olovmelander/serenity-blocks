/**
 * processPhysics callback-schedule characterization (plan §5.2 prerequisite).
 *
 * "processPhysics fires 18 distinct callbacks... Write the schedule — which
 * callback fires at which wave with which payload — BEFORE extraction, and pin
 * it with a characterization test; otherwise 60+ theme/juice consumers break
 * unreviewably."
 *
 * These goldens are the animation-replay CONTRACT the §5.2 pure resolveCascade
 * must reproduce when it drives effects as a replay of precomputed waves. They
 * were recorded from the live engine 2026-07-11 (isSeeking=true → delays
 * skipped, schedules deterministic). draw()/updateBoard() render ticks are
 * excluded (animation pacing, not sim semantics); onGravityStep counts ARE
 * pinned (fall distances are sim-deterministic).
 *
 * Notable contract facts these pins encode:
 *  - Wave order: [level-up trio if crossed] → playLineClear → onScoreAdd →
 *    onLineClear(lineCount, footprintCols, holeMask, clearedRows, cascadeCount)
 *    → [onTSpin] → onLineClearImpact → triggerFlash → triggerBackgroundPulse →
 *    gravity steps → next wave (triggerCombo+triggerCascadeWave FIRST) →
 *    onCascadeComplete(waveCount) → [perfect-clear: onScoreAdd(bonus) →
 *    onPerfectClear(depth, bonus)] → onGarbageReady(summary).
 *  - Level-up (playLevelUp/onLevelUp/updateBackground) fires BEFORE the same
 *    wave's clear callbacks.
 *  - Scores match the golden formula incl. the +10%/level additive multiplier
 *    at level 1 (single=275) and the cascade bonus (wave-2 single=495).
 */
import { describe, it, expect } from 'vitest';
import { processPhysicsLegacy, processPhysicsResolved } from '../../src/core/physics.js';
import { createBoardGrid } from '../../src/core/board.js';
import { COLS, ROWS, HIDDEN_ROWS } from '../../src/core/constants.js';

const BOTTOM = ROWS + HIDDEN_ROWS - 1;
const RENDER_TICKS = new Set(['draw', 'updateBoard']);

function fullRowPiece(y, id = `row-${y}`) {
    return {
        pieceId: id, color: '#666', type: 'garbage', x: 0, y, shape: [Array(COLS).fill(1)],
    };
}
function loneBlock(x, y, id = `blk-${x}-${y}`) {
    return {
        pieceId: id, color: '#888', type: 'block', x, y, shape: [[1]],
    };
}
function makeState(overrides = {}) {
    return {
        boardGrid: createBoardGrid(),
        lockedPieces: [],
        score: 0,
        lines: 0,
        level: 1,
        linesUntilNextLevel: 15,
        disableLevelProgression: false,
        isSeeking: true, // skip animation delays → deterministic schedule
        comboState: { lockFootprint: [], manualColumns: [] },
        ...overrides,
    };
}

/** Record [name, ...scalarized args], excluding pure render ticks. */
function recorder(log) {
    const scalarize = (a) => {
        if (a === null || a === undefined || typeof a !== 'object') return a;
        if (Array.isArray(a)) return a.join(',');
        return '<obj>';
    };
    return new Proxy({}, {
        get(_t, prop) {
            if (typeof prop !== 'string') return undefined;
            return (...args) => {
                if (!RENDER_TICKS.has(prop)) log.push([prop, ...args.map(scalarize)]);
            };
        },
    });
}

const gravitySteps = (log) => log.filter(([n]) => n === 'onGravityStep').length;
const withoutGravity = (log) => log.filter(([n]) => n !== 'onGravityStep');

// Both implementations must reproduce the SAME golden schedules: legacy is
// the recording source; the §5.2 resolver replay (cascadeV2) is certified
// against the identical pins — this is the cutover's primary behavioral gate.
describe.each([
    ['legacy', processPhysicsLegacy],
    ['cascadeV2 replay', processPhysicsResolved],
])('processPhysics callback schedule — %s (the §5.2 animation-replay contract)', (_impl, processPhysics) => {
    it('single clear: full wave sequence, payloads, and gravity-step count', async () => {
        const gs = makeState({ lockedPieces: [fullRowPiece(BOTTOM), loneBlock(0, BOTTOM - 4)] });
        const log = [];
        await processPhysics(gs, recorder(log));

        expect(withoutGravity(log)).toEqual([
            ['playLineClear'],
            ['onScoreAdd', 275], // 250 base + 10% level-1 additive
            ['onLineClear', 1, '5', 'false,false,false,false,false,true,false,false,false,false', '23', 1],
            ['onLineClearImpact', 1, 1],
            ['triggerFlash', '23'],
            ['triggerBackgroundPulse', 1],
            ['onCascadeComplete', 1],
            ['onGarbageReady', '<obj>'],
        ]);
        expect(gravitySteps(log)).toBe(4); // lone block falls 4 rows
        expect([gs.score, gs.lines, gs.level, gs.lockedPieces.length]).toEqual([275, 1, 1, 1]);
    });

    it('double clear: lineCount/clearedRows/holeMask scale, single wave', async () => {
        const gs = makeState({
            lockedPieces: [fullRowPiece(BOTTOM), fullRowPiece(BOTTOM - 1), loneBlock(0, BOTTOM - 4)],
        });
        const log = [];
        await processPhysics(gs, recorder(log));

        const lineClear = log.find(([n]) => n === 'onLineClear');
        expect(lineClear).toEqual(['onLineClear', 2, '5',
            'false,false,false,false,false,true,false,false,false,false,false,false,false,false,false,true,false,false,false,false',
            '23,22', 1]);
        expect(log.find(([n]) => n === 'onScoreAdd')[1]).toBe(550); // 500 + 10%
        expect(log.filter(([n]) => n === 'onLineClear')).toHaveLength(1); // one wave
        expect([gs.score, gs.lines]).toEqual([550, 2]);
    });

    it('perfect clear: bonus scored + onPerfectClear AFTER onCascadeComplete', async () => {
        const gs = makeState({ lockedPieces: [fullRowPiece(BOTTOM)] });
        const log = [];
        await processPhysics(gs, recorder(log));

        const names = log.map(([n]) => n);
        const completeIdx = names.indexOf('onCascadeComplete');
        const perfectIdx = names.indexOf('onPerfectClear');
        expect(perfectIdx).toBeGreaterThan(completeIdx);
        expect(log[perfectIdx]).toEqual(['onPerfectClear', 1, 1375]); // depth*1250 + 10%
        expect(gs.score).toBe(275 + 1375);
        expect(gs.lockedPieces).toHaveLength(0);
    });

    it('cascade: wave 2 opens with triggerCombo+triggerCascadeWave and carries cascadeCount=2', async () => {
        const gs = makeState();
        gs.lockedPieces.push(fullRowPiece(BOTTOM));
        gs.lockedPieces.push({
            pieceId: 'gap-row', color: '#777', type: 'garbage', x: 1, y: BOTTOM - 1, shape: [Array(COLS - 1).fill(1)],
        });
        gs.lockedPieces.push(loneBlock(0, BOTTOM - 2, 'faller'));
        const log = [];
        await processPhysics(gs, recorder(log));

        expect(withoutGravity(log)).toEqual([
            ['playLineClear'],
            ['onScoreAdd', 275],
            ['onLineClear', 1, '5', 'false,false,false,false,false,true,false,false,false,false', '23', 1],
            ['onLineClearImpact', 1, 1],
            ['triggerFlash', '23'],
            ['triggerBackgroundPulse', 1],
            // ── wave 2 (the faller completes the gap row) ──
            ['triggerCombo', 2],
            ['triggerCascadeWave', 2],
            ['playLineClear'],
            ['onScoreAdd', 495], // 250 base + 200·(2-1)² cascade bonus, +10%
            ['onLineClear', 1, '0,1,2,3,4,5,6,7,8,9', 'true,true,true,true,true,true,true,true,true,true', '23', 2],
            ['onLineClearImpact', 1, 2],
            ['triggerFlash', '23'],
            ['triggerBackgroundPulse', 1],
            ['onCascadeComplete', 2],
            ['onScoreAdd', 2750], // depth-2 perfect clear: 2·1250, +10%
            ['onPerfectClear', 2, 2750],
            ['onGarbageReady', '<obj>'],
        ]);
        expect([gs.score, gs.lines]).toEqual([3520, 2]);
    });

    it('level-up trio fires BEFORE the same wave\'s clear callbacks', async () => {
        const gs = makeState({
            linesUntilNextLevel: 1,
            lockedPieces: [fullRowPiece(BOTTOM), loneBlock(0, BOTTOM - 4)],
        });
        const log = [];
        await processPhysics(gs, recorder(log));

        expect(withoutGravity(log).slice(0, 5)).toEqual([
            ['playLevelUp'],
            ['onLevelUp', 2],
            ['updateBackground', 2],
            ['playLineClear'],
            ['onScoreAdd', 300], // 250 + 10%·level-2
        ]);
        expect(gs.level).toBe(2);
        expect(gs.linesUntilNextLevel).toBe(15);
    });

    it('T-spin: onTSpin(lineCount) fires immediately after onLineClear', async () => {
        const gs = makeState({
            comboState: { lockFootprint: [], manualColumns: [], tSpin: true },
            lockedPieces: [fullRowPiece(BOTTOM), loneBlock(0, BOTTOM - 4)],
        });
        const log = [];
        await processPhysics(gs, recorder(log));

        const names = log.map(([n]) => n);
        expect(names.indexOf('onTSpin')).toBe(names.indexOf('onLineClear') + 1);
        expect(log[names.indexOf('onTSpin')]).toEqual(['onTSpin', 1]);
    });

    it('B2B: fires only when the PREVIOUS lock was difficult and this one is too', async () => {
        // onB2B(true) fires BEFORE b2bActive is re-set — it reflects the prior
        // lock (physics.js:850-853). A tetris with b2bActive preset → fires and
        // stays armed.
        const tetrisRows = [BOTTOM, BOTTOM - 1, BOTTOM - 2, BOTTOM - 3].map((y) => fullRowPiece(y, `r${y}`));
        const armed = makeState({ b2bActive: true, lockedPieces: [...tetrisRows, loneBlock(0, BOTTOM - 8)] });
        const armedLog = [];
        await processPhysics(armed, recorder(armedLog));
        const names = armedLog.map(([n]) => n);
        expect(names.indexOf('onB2B')).toBeGreaterThan(names.indexOf('onLineClear'));
        expect(names.indexOf('onB2B')).toBeLessThan(names.indexOf('onLineClearImpact'));
        expect(armedLog[names.indexOf('onB2B')]).toEqual(['onB2B', true]);
        expect(armed.b2bActive).toBe(true); // difficult clear re-arms

        // A NON-difficult clear breaks the chain: no onB2B, b2bActive resets.
        const broken = makeState({ b2bActive: true, lockedPieces: [fullRowPiece(BOTTOM), loneBlock(0, BOTTOM - 4)] });
        const brokenLog = [];
        await processPhysics(broken, recorder(brokenLog));
        expect(brokenLog.map(([n]) => n)).not.toContain('onB2B');
        expect(broken.b2bActive).toBe(false);
    });

    it('no full lines: no clear callbacks, physics settles quietly', async () => {
        const gs = makeState({ lockedPieces: [loneBlock(3, BOTTOM)] });
        const log = [];
        await processPhysics(gs, recorder(log));
        expect(log.filter(([n]) => ['onLineClear', 'playLineClear', 'onPerfectClear'].includes(n))).toEqual([]);
        expect(gs.isProcessingPhysics).toBeFalsy();
    });
});

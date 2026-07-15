/**
 * §5.2/§5.10 differential gate (test tier): the pure resolveCascade must
 * reproduce the legacy async processPhysics EXACTLY — board digest, score,
 * lines, level, drop interval, B2B, per-wave payloads, hole masks (the
 * competitive-visible Quadra channel — parity here is the plan's abort
 * criterion), garbage summary, gravity-step counts, and comboState.
 *
 * Structured scenarios + seeded-random boards (RandomStream → reproducible in
 * CI; a divergence prints its case seed). Both paths receive independent deep
 * clones of the same inputs.
 */
import { describe, it, expect } from 'vitest';
import { processPhysicsLegacy, processPhysicsResolved } from '../../src/core/physics.js';
import { resolveCascade } from '../../src/core/cascade-resolver.js';
import { createBoardGrid } from '../../src/core/board.js';
import { computeBoardDigest } from '../../src/core/demo/demo-state.js';
import { RandomStream } from '../../src/core/rng.js';
import { COLS, ROWS, HIDDEN_ROWS } from '../../src/core/constants.js';

const BOTTOM = ROWS + HIDDEN_ROWS - 1;

function clonePieces(pieces) {
    return pieces.map((p) => ({ ...p, shape: p.shape.map((r) => r.slice()) }));
}

function makeGameState(pieces, context) {
    return {
        boardGrid: context.boardHeight
            ? Array.from({ length: context.boardHeight }, () => Array(COLS).fill(null))
            : createBoardGrid(),
        lockedPieces: clonePieces(pieces),
        score: 1000, // non-zero so deltas are real deltas
        lines: context.lines,
        level: context.level,
        linesUntilNextLevel: context.linesUntilNextLevel,
        dropInterval: context.dropInterval,
        disableLevelProgression: context.disableLevelProgression,
        b2bActive: context.b2bActive,
        isSeeking: true,
        lineClearCounts: {},
        comboState: context.comboState ? JSON.parse(JSON.stringify(context.comboState)) : undefined,
        lastPlacedPieceX: context.lastPlacedPieceX,
        comboMultiplierEnabled: context.comboMultiplierEnabled,
        comboMultiplier: context.comboMultiplier,
        comboCount: context.comboCount,
        speedMultiplier: context.speedMultiplier,
    };
}

/** Legacy driver: real gameState + recording callbacks, delays skipped. */
async function runLegacy(pieces, context) {
    const gs = makeGameState(pieces, context);
    const events = {
        scoreAdds: [], lineClears: [], gravitySteps: 0, garbage: null, perfect: null, b2b: 0,
    };
    await processPhysicsLegacy(gs, {
        onScoreAdd: (points) => events.scoreAdds.push(points),
        onLineClear: (count, holeCols, masks, rows, wave) => events.lineClears.push({
            count, holeCols: [...holeCols], masks: masks.map((m) => m.slice()), rows: [...rows], wave,
        }),
        onGravityStep: () => { events.gravitySteps += 1; },
        onGarbageReady: (summary) => { events.garbage = JSON.parse(JSON.stringify(summary)); },
        onPerfectClear: (depth, bonus) => { events.perfect = { depth, bonus }; },
        onB2B: () => { events.b2b += 1; },
    });
    return { gs, events };
}

/** Record EVERY callback (render ticks included) as [name, ...scalarized args]. */
function fullRecorder(log) {
    const scalarize = (a) => {
        if (a === null || a === undefined || typeof a !== 'object') return a;
        if (Array.isArray(a)) return a.join(',');
        return '<obj>';
    };
    return new Proxy({}, {
        get(_t, prop) {
            if (typeof prop !== 'string') return undefined;
            return (...args) => { log.push([prop, ...args.map(scalarize)]); };
        },
    });
}

async function runWithFullLog(impl, pieces, context) {
    const gs = makeGameState(pieces, context);
    const log = [];
    await impl(gs, fullRecorder(log));
    return { gs, log };
}

function compare(pieces, context, label) {
    return (async () => {
        const { gs, events } = await runLegacy(pieces, context);
        const result = resolveCascade(clonePieces(pieces), context);

        // Final state
        expect(computeBoardDigest(result.boardAfter), `${label}: board digest`).toBe(computeBoardDigest(gs.boardGrid));
        expect(1000 + result.scoreDelta, `${label}: score`).toBe(gs.score);
        expect(result.linesAfter, `${label}: lines`).toBe(gs.lines);
        expect(result.levelAfter, `${label}: level`).toBe(gs.level);
        expect(result.linesUntilNextLevelAfter, `${label}: linesUntilNextLevel`).toBe(gs.linesUntilNextLevel);
        expect(result.dropIntervalAfter, `${label}: dropInterval`).toBe(gs.dropInterval);
        expect(result.b2bActiveAfter, `${label}: b2bActive`).toBe(Boolean(gs.b2bActive));
        expect(result.lockedPiecesAfter.length, `${label}: piece count`).toBe(gs.lockedPieces.length);

        // Per-wave payloads (what the animation replay must reproduce)
        expect(result.waves.length, `${label}: wave count`).toBe(events.lineClears.length);
        result.waves.forEach((wave, i) => {
            const legacy = events.lineClears[i];
            expect(wave.fullLines, `${label} w${i}: rows`).toEqual(legacy.rows);
            expect(wave.holeColumns, `${label} w${i}: holeCols`).toEqual(legacy.holeCols);
            expect(wave.holeMasks, `${label} w${i}: masks`).toEqual(legacy.masks);
            expect(wave.cascadeCount, `${label} w${i}: cascadeCount`).toBe(legacy.wave);
            expect(wave.fullLines.length, `${label} w${i}: count`).toBe(legacy.count);
        });

        // Score event sequence: wave points then optional perfect bonus
        const expectedScoreAdds = result.waves.map((w) => w.points);
        if (result.perfectClear) expectedScoreAdds.push(result.perfectClear.bonus);
        expect(expectedScoreAdds, `${label}: score sequence`).toEqual(events.scoreAdds);
        expect(result.perfectClear, `${label}: perfect clear`).toEqual(events.perfect);
        expect(result.waves.filter((w) => w.b2bFired).length, `${label}: b2b fires`).toBe(events.b2b);

        // Gravity animation parity
        const resolverSteps = result.waves.reduce((n, w) => n + w.gravitySteps, 0);
        expect(resolverSteps, `${label}: gravity steps`).toBe(events.gravitySteps);

        // Garbage summary (competitive wire payload) + comboState writeback
        expect(result.garbageSummary, `${label}: garbage summary`).toEqual(events.garbage);
        if (gs.comboState) {
            expect(result.comboStateAfter.depth, `${label}: depth`).toBe(gs.comboState.depth);
            expect(result.comboStateAfter.complexity, `${label}: complexity`).toBe(gs.comboState.complexity);
            expect(result.comboStateAfter.sendForPerfectClear, `${label}: sendForPerfectClear`).toBe(gs.comboState.sendForPerfectClear);
            expect(result.comboStateAfter.holeMask, `${label}: holeMask matrix`).toEqual(gs.comboState.holeMask);
        }
        expect(result.lineClearCountsDelta, `${label}: lineClearCounts`).toEqual(gs.lineClearCounts);
        if (context.comboMultiplierEnabled) {
            expect(result.comboCountAfter, `${label}: comboCount`).toBe(gs.comboCount);
            expect(result.comboMultiplierAfter, `${label}: comboMultiplier`).toBe(gs.comboMultiplier);
        }

        // ── §5.2 cutover leg: the V2 replay must equal legacy on the FULL
        // callback log (order + scalarized args, render ticks included) and
        // the complete end state. This is the dual-path certification the
        // flag flip rides on. ──
        const legacyRun = await runWithFullLog(processPhysicsLegacy, pieces, context);
        const v2Run = await runWithFullLog(processPhysicsResolved, pieces, context);
        expect(v2Run.log, `${label}: v2 full callback log`).toEqual(legacyRun.log);
        expect(computeBoardDigest(v2Run.gs.boardGrid), `${label}: v2 board digest`)
            .toBe(computeBoardDigest(legacyRun.gs.boardGrid));
        ['score', 'lines', 'level', 'linesUntilNextLevel', 'dropInterval', 'b2bActive',
            'comboCount', 'comboMultiplier'].forEach((field) => {
            expect(v2Run.gs[field], `${label}: v2 ${field}`).toBe(legacyRun.gs[field]);
        });
        expect(v2Run.gs.lockedPieces.length, `${label}: v2 piece count`).toBe(legacyRun.gs.lockedPieces.length);
        expect(JSON.stringify(v2Run.gs.comboState ?? null), `${label}: v2 comboState`)
            .toBe(JSON.stringify(legacyRun.gs.comboState ?? null));
        expect(v2Run.gs.lineClearCounts, `${label}: v2 lineClearCounts`).toEqual(legacyRun.gs.lineClearCounts);
    })();
}

function baseContext(overrides = {}) {
    return {
        level: 1,
        lines: 0,
        linesUntilNextLevel: 15,
        dropInterval: 800,
        disableLevelProgression: false,
        b2bActive: false,
        comboState: { lockFootprint: [], manualColumns: [] },
        ...overrides,
    };
}

function fullRowPiece(y, id = `row-${y}`) {
    return {
        pieceId: id, color: '#666', type: 'garbage', x: 0, y, shape: [Array(COLS).fill(1)],
    };
}
function block(x, y, id = `b-${x}-${y}`) {
    return {
        pieceId: id, color: '#888', type: 'block', x, y, shape: [[1]],
    };
}

describe('resolveCascade ≡ processPhysics (structured scenarios)', () => {
    it('no clear', () => compare([block(3, BOTTOM)], baseContext(), 'noop'));
    it('single clear + survivor', () => compare([fullRowPiece(BOTTOM), block(0, BOTTOM - 4)], baseContext(), 'single'));
    it('double clear', () => compare(
        [fullRowPiece(BOTTOM), fullRowPiece(BOTTOM - 1), block(0, BOTTOM - 4)],
        baseContext(),
        'double',
    ));
    it('tetris with B2B armed', () => compare(
        [BOTTOM, BOTTOM - 1, BOTTOM - 2, BOTTOM - 3].map((y) => fullRowPiece(y, `r${y}`)).concat(block(0, BOTTOM - 8)),
        baseContext({ b2bActive: true }),
        'tetris-b2b',
    ));
    it('perfect clear', () => compare([fullRowPiece(BOTTOM)], baseContext(), 'perfect'));
    it('two-wave cascade into perfect clear', () => compare([
        fullRowPiece(BOTTOM),
        {
            pieceId: 'gap', color: '#777', type: 'garbage', x: 1, y: BOTTOM - 1, shape: [Array(COLS - 1).fill(1)],
        },
        block(0, BOTTOM - 2, 'faller'),
    ], baseContext(), 'cascade'));
    it('level-up wave (progression + dropInterval recompute)', () => compare(
        [fullRowPiece(BOTTOM), block(0, BOTTOM - 4)],
        baseContext({ linesUntilNextLevel: 1 }),
        'level-up',
    ));
    it('level counter reset with progression disabled', () => compare(
        [fullRowPiece(BOTTOM), block(0, BOTTOM - 4)],
        baseContext({ linesUntilNextLevel: 1, disableLevelProgression: true }),
        'no-progress',
    ));
    it('T-spin flag + manual hole columns + lock footprint', () => compare(
        [fullRowPiece(BOTTOM), block(0, BOTTOM - 4)],
        baseContext({
            comboState: {
                lockFootprint: [{ x: 4, y: BOTTOM }, { x: 5, y: BOTTOM }],
                manualColumns: [4, 5],
                tSpin: true,
                sourceColor: '#f0f',
                sourcePiece: 'T',
                sequence: 7,
            },
        }),
        't-spin',
    ));
    it('odyssey combo multiplier scales wave + perfect points', () => compare(
        [fullRowPiece(BOTTOM)],
        baseContext({ comboMultiplierEnabled: true, comboMultiplier: 2, comboCount: 2 }),
        'combo-mult',
    ));
    it('odyssey speed multiplier divides the recomputed drop interval on level-up', () => compare(
        [fullRowPiece(BOTTOM), block(0, BOTTOM - 4)],
        baseContext({ linesUntilNextLevel: 1, speedMultiplier: 1.5 }),
        'speed-mult',
    ));
    it('tall Infinity-style board (40 rows) cascades identically', () => {
        const tallBottom = 40 - 1;
        return compare([
            fullRowPiece(tallBottom),
            {
                pieceId: 'gap', color: '#777', type: 'garbage', x: 1, y: tallBottom - 1, shape: [Array(COLS - 1).fill(1)],
            },
            block(0, tallBottom - 9, 'high-faller'), // falls 8 rows into the gap
        ], baseContext({ boardHeight: 40 }), 'tall-board');
    });
});

describe('resolveCascade ≡ processPhysics (seeded random boards)', () => {
    const CASES = 120;

    function randomScenario(rng) {
        const pieces = [];
        // Stacked rows from the bottom: each with 0-2 holes (0 holes = clears).
        const stackRows = rng.nextInt(6);
        for (let r = 0; r < stackRows; r += 1) {
            const y = BOTTOM - r;
            const holes = new Set();
            const holeCount = rng.nextInt(3);
            for (let h = 0; h < holeCount; h += 1) holes.add(rng.nextInt(COLS));
            for (let x = 0; x < COLS; x += 1) {
                if (!holes.has(x)) pieces.push(block(x, y, `s${r}-${x}`));
            }
        }
        // Floating debris above the stack (cascade fuel).
        const debris = rng.nextInt(8);
        for (let d = 0; d < debris; d += 1) {
            pieces.push(block(rng.nextInt(COLS), BOTTOM - stackRows - 1 - rng.nextInt(4), `d${d}`));
        }
        // Random lock footprint near the stack top.
        const footprint = [];
        const fpCells = 1 + rng.nextInt(4);
        for (let f = 0; f < fpCells; f += 1) {
            footprint.push({ x: rng.nextInt(COLS), y: BOTTOM - rng.nextInt(Math.max(1, stackRows)) });
        }
        const comboCount = rng.nextInt(4);
        const context = baseContext({
            level: 1 + rng.nextInt(5),
            lines: rng.nextInt(40),
            linesUntilNextLevel: 1 + rng.nextInt(15),
            b2bActive: rng.nextInt(2) === 1,
            disableLevelProgression: rng.nextInt(4) === 0,
            comboMultiplierEnabled: rng.nextInt(3) === 0,
            comboMultiplier: 1 + comboCount * 0.5,
            comboCount,
            comboState: {
                lockFootprint: footprint,
                manualColumns: [rng.nextInt(COLS)],
                tSpin: rng.nextInt(6) === 0,
                depth: 0,
                complexity: 0,
            },
        });
        return { pieces, context };
    }

    it(`${CASES} seeded-random boards are bit-identical across both paths`, async () => {
        const rng = new RandomStream('differential-5.2', 'cases');
        for (let i = 0; i < CASES; i += 1) {
            const { pieces, context } = randomScenario(rng);
            // eslint-disable-next-line no-await-in-loop
            await compare(pieces, context, `case-${i}`);
        }
    }, 60000);

    it('v2 advances the replay sim-clock identically to legacy (demo alignment)', async () => {
        const pieces = [
            fullRowPiece(BOTTOM),
            {
                pieceId: 'gap', color: '#777', type: 'garbage', x: 1, y: BOTTOM - 1, shape: [Array(COLS - 1).fill(1)],
            },
            block(0, BOTTOM - 2, 'faller'),
        ];
        const context = baseContext();
        const runs = [];
        for (const impl of [processPhysicsLegacy, processPhysicsResolved]) {
            const gs = makeGameState(pieces, context);
            gs.isReplay = true; // isSeeking already true → delays skipped but clock advances
            gs.simTimeMs = 5000;
            // eslint-disable-next-line no-await-in-loop
            await impl(gs, {});
            runs.push(gs);
        }
        expect(runs[1].simTimeMs).toBe(runs[0].simTimeMs);
        expect(runs[1].simFrame).toBe(runs[0].simFrame);
        expect(runs[1].lastTime).toBe(runs[0].lastTime);
        expect(runs[0].simTimeMs).toBeGreaterThan(5000); // the clock actually moved
    });

    it('resolver purity: inputs are never mutated', () => {
        const pieces = [fullRowPiece(BOTTOM), block(0, BOTTOM - 3)];
        const snapshotBefore = JSON.stringify(pieces);
        const context = baseContext({ comboState: { lockFootprint: [{ x: 1, y: BOTTOM }], manualColumns: [1] } });
        const contextBefore = JSON.stringify(context);
        resolveCascade(pieces, context);
        expect(JSON.stringify(pieces)).toBe(snapshotBefore);
        expect(JSON.stringify(context)).toBe(contextBefore);
    });
});

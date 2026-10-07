/* eslint-disable no-await-in-loop -- Both physics paths resolve each fixture completely before the next. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    findConnectedComponents, removeClearedLines,
} from '../../src/core/cascade-helpers.js';
import { rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { resolveCascade } from '../../src/core/cascade-resolver.js';
import { processPhysicsLegacy, processPhysicsResolved } from '../../src/core/physics.js';
import { COLS } from '../../src/core/constants.js';

const fixtureUrl = new URL('../fixtures/odyssey-cascade-cell-loss.json', import.meta.url);
const fixtures = JSON.parse(readFileSync(fixtureUrl, 'utf8'));

function occupiedCoordinates(pieces) {
    return pieces.flatMap((piece) => piece.shape.flatMap((row, localY) => row.flatMap((cell, localX) => (
        cell > 0 ? [`${piece.x + localX},${piece.y + localY}`] : []
    )))).sort();
}

function expectNoOverlaps(pieces) {
    const coordinates = occupiedCoordinates(pieces);
    expect(new Set(coordinates).size).toBe(coordinates.length);
}

function makeState(pieces, context) {
    return {
        ...structuredClone(context),
        boardGrid: Array.from({ length: context.boardHeight || 24 }, () => Array(COLS).fill(null)),
        lockedPieces: structuredClone(pieces),
        score: 0,
        lines: context.lines ?? 0,
        level: context.level ?? 1,
        linesUntilNextLevel: context.linesUntilNextLevel ?? 15,
        dropInterval: context.dropInterval ?? 1000,
        lineClearCounts: {},
        isSeeking: true,
    };
}

async function compareConservation(pieces, context) {
    const before = structuredClone(pieces);
    const contextBefore = structuredClone(context);
    const cellCount = occupiedCoordinates(pieces).length;
    expectNoOverlaps(pieces);
    const canonical = resolveCascade(pieces, context);
    expect(pieces).toEqual(before);
    expect(context).toEqual(contextBefore);
    expectNoOverlaps(canonical.lockedPiecesAfter);
    expect(canonical.boardAfter.flat().filter(Boolean).length)
        .toBe(cellCount - canonical.linesClearedThisTurn * COLS);
    for (const implementation of [processPhysicsLegacy, processPhysicsResolved]) {
        const state = makeState(pieces, context);
        let cleared = 0;
        const waves = [];
        await implementation(state, {
            onLineClear: (lines) => { cleared += lines; waves.push(lines); },
            onGravityStep: () => {
                expectNoOverlaps(state.lockedPieces);
                expect(state.boardGrid.flat().filter(Boolean).length).toBe(cellCount - cleared * COLS);
            },
        });
        expectNoOverlaps(state.lockedPieces);
        expect(state.boardGrid.flat().filter(Boolean).length).toBe(cellCount - cleared * COLS);
        expect(state.boardGrid).toEqual(canonical.boardAfter);
        expect(state.lines).toBe(canonical.linesAfter);
        expect(state.score).toBe(canonical.scoreDelta);
        expect(waves).toEqual(canonical.waves.map((wave) => wave.fullLines.length));
    }
    return canonical;
}

describe('cascade clearing preserves cells and fragment geometry', () => {
    it('leaves all four survivors of a fourteen-cell prepared board in both physics paths', async () => {
        // Previously clearing y=20 shifted the L branch from (1,22) onto the
        // separate fragment at (1,21), silently overwriting one survivor.
        const pieces = [
            {
                x: 0, y: 20, shape: [[1, 0], [1, 0], [1, 1]], pieceId: 'L', shapeKey: 'L',
            },
            {
                x: 1, y: 21, shape: [[1]], pieceId: 'fragment', shapeKey: 'T',
            },
            {
                x: 1, y: 20, shape: [Array(9).fill(1)], pieceId: 'clear-row', shapeKey: 'I',
            },
        ];
        const result = await compareConservation(pieces, {
            boardHeight: 24,
            level: 1,
            lines: 0,
            linesUntilNextLevel: 15,
            dropInterval: 1000,
            disableLevelProgression: true,
        });
        expect(result.linesClearedThisTurn).toBe(1);
        expect(result.boardAfter.flat().filter(Boolean)).toHaveLength(4);
        expect(result.lockedPiecesAfter.find((piece) => piece.pieceId === 'fragment')).toBeDefined();
    });

    it('preserves every surviving global coordinate across multiple cuts and splits garbage identity correctly', () => {
        const piece = {
            x: 2,
            y: 6,
            shape: [[1, 0], [1, 1], [0, 1], [1, 1], [1, 0]],
            pieceId: 'attack:42-row:2',
            shapeKey: 'GARBAGE',
            type: 'garbage',
            color: '#c04080',
        };
        const survivors = removeClearedLines([piece], [9, 7]);
        expect(occupiedCoordinates(survivors)).toEqual(['2,10', '2,6', '3,8']);
        const components = findConnectedComponents(rebuildBoardGridFromPieces(survivors));
        expect(components).toHaveLength(3);
        expect(occupiedCoordinates(components)).toEqual(['2,10', '2,6', '3,8']);
        expect(components.every((part) => part.pieceId === 'attack:42-row:2'
            && part.color === '#c04080' && part.type === 'garbage')).toBe(true);
    });

    it('does not shift hidden or off-board survivors and removes pieces whose occupied cells all clear', () => {
        const piece = {
            x: -1, y: -1, shape: [[0, 1], [0, 1], [0, 1], [0, 1]], pieceId: 'offset-I',
        };
        const erased = {
            x: 3, y: 0, shape: [[0, 1, 1], [0, 0, 0]], pieceId: 'erased',
        };
        const survivors = removeClearedLines([piece, erased], [0, 2]);
        expect(occupiedCoordinates(survivors)).toEqual(['0,-1', '0,1']);
        expect(survivors).toHaveLength(1);
        expect(survivors[0]).toMatchObject({ x: -1, y: -1, pieceId: 'offset-I' });
    });

    it.each(fixtures.fixtures)('conserves cells in the real recorded trigger $id', async (fixture) => {
        expect(fixture.provenance).toBeDefined();
        await compareConservation(fixture.lockedPieces, fixture.context);
    });
});

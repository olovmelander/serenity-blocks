import { GameState, applyGarbage, spawnPiece } from '../../src/core/game.js';
import { findConnectedComponents } from '../../src/core/cascade-helpers.js';
import { rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1 } from '../../src/core/infinity-spawn-policy.js';
import { captureGarbage } from '../bot-ai-audit-2026-11/probes.mjs';
import { deal, replay, spawn } from '../bot-ai-audit-2026-11/solo.mjs';
import { PuzzleBotController } from '../../src/core/ai/puzzle-bot-controller.js';
import { HIDDEN_ROWS } from '../../src/core/constants.js';
import { seededRandom } from '../../src/utils/helpers.js';

export async function variants(fixtures) {
    const packets = await captureGarbage();
    const boards = [];
    for (const fixture of fixtures.filter(f => f.lock === 12)) {
        // Harvest a natural high stack from real locks without adding any garbage.
        const clean = deal(fixture.seed);
        const feeder = new PuzzleBotController({ playerState: clean, actions: {}, difficulty: 1,
            rng: seededRandom((fixture.seed ^ 0x85ebca6b) >>> 0) });
        for (let lock = 0; lock < 400 && !clean.isGameOver; lock++) {
            const top = clean.boardGrid.findIndex(row => row.some(Boolean));
            if (top >= 0 && top - HIDDEN_ROWS <= 3) {
                boards.push({ seed: fixture.seed, lock, kind: 'cleanRoof', state: structuredClone({
                    boardGrid: clean.boardGrid, currentPiece: clean.currentPiece, nextPieces: clean.nextPieces,
                    piecesPlaced: clean.piecesPlaced, isAlive: true,
                }) });
                break;
            }
            await replay(clean, feeder.plan().actions, { spawnPiece: () => spawn(clean) });
        }
        clean.reset();
        for (const kind of ['rubble', 'roof', 'infinity']) {
            const infinity = kind === 'infinity';
            const state = new GameState({ isInfinityMode: infinity, initialInfinityRows: 44,
                infinityVisibleRows: 18, infinitySpawnOffsetRows: 3,
                infinitySpawnPolicy: INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1 });
            const offset = state.boardGrid.length - fixture.state.boardGrid.length;
            state.lockedPieces = findConnectedComponents(fixture.state.boardGrid).map(body => ({ ...body, y: body.y + offset }));
            rebuildBoardGridFromPieces(state.lockedPieces, state.boardGrid);
            if (!infinity) {
                const top = state.boardGrid.findIndex(row => row.some(Boolean));
                const rows = kind === 'rubble' ? packets.length : Math.max(0, top - 7);
                const entries = Array.from({ length: rows }, (_, i) => packets[i % packets.length]);
                if (applyGarbage(state, entries).topOut) throw Error('Invalid pressure fixture');
            }
            state.nextPieces = [fixture.state.currentPiece.shapeKey, ...fixture.state.nextPieces];
            spawnPiece(state);
            if (state.isGameOver) throw Error('Fixture lacks a legal spawn on ' + kind + ' seed ' + fixture.seed);
            boards.push({ seed: fixture.seed, lock: fixture.lock, kind, state });
        }
    }
    return boards;
}

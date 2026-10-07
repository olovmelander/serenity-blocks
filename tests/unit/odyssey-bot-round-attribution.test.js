import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { fillBag, spawnPiece } from '../../src/core/game.js';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { OdysseyBotMatch } from '../../src/core/odyssey/OdysseyBotMatch.js';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function createMatch() {
    const levelConfig = LEVEL_CONFIGS.find((level) => level.mechanics.versus);
    const hybridEngine = new GameplayHybridEngine();
    hybridEngine.configure(levelConfig);
    const session = { levelConfig, hybridEngine, gameState: hybridEngine.createGameState() };
    const match = new OdysseyBotMatch(session, { seed: 1234, isActive: () => !session.retired });
    session.duel = match;
    fillBag(session.gameState.nextPieces, session.gameState.randomGenerator);
    spawnPiece(session.gameState);
    match.prepareBot();
    return match;
}

const attackSummary = {
    totalLines: 4,
    comboStages: 1,
    manualColumns: [4],
    holeMask: Array.from({ length: 4 }, () => [false, false, false, false, true, false, false, false, false, false]),
};

describe('Odyssey round death attribution', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it.each([0, 1])('keeps player %i self top-out uncredited when an opponent cascade finishes later', async (victim) => {
        const match = createMatch();
        const opponent = 1 - victim;
        const cascade = deferred();
        match.players[opponent].latestPhysicsPromise = cascade.promise;
        const callbacks = opponent === 0 ? match.wrapHumanCallbacks({}) : match.botCallbacks;
        match.multiplayer.frags[opponent] = 6;
        match.markTopOut(victim);
        match.update(100, 16, {});

        // The surviving board may finish an already-started cascade at the
        // barrier. Its attack cannot cause a death that happened beforehand.
        callbacks.onGarbageReady(attackSummary);
        cascade.resolve();
        await match.transition;

        expect(match.multiplayer.deaths[victim]).toBe(1);
        expect(match.multiplayer.frags[opponent]).toBe(6);
        expect(match.multiplayer.isGameOver).toBe(false);
    });

    it('credits a real garbage insertion top-out and retires the round before spawning', async () => {
        const match = createMatch();
        const bot = match.players[1];
        bot.lockedPieces = [{ x: 0, y: 4, shape: [[1]], pieceId: 100 }];
        match.wrapHumanCallbacks({}).onGarbageReady(attackSummary);
        match.botCallbacks.spawnPiece();
        match.update(100, 16, {});
        await match.transition;

        expect(bot.isGameOver).toBe(true);
        expect(match.multiplayer.frags).toEqual([1, 0]);
        expect(match.multiplayer.deaths).toEqual([0, 1]);
        expect(match.roundActive).toBe(false);
        expect(match.intermissionMs).toBe(900);
    });
});

import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    applyGarbage, fillBag, hardDrop, rotate, spawnPiece,
} from '../../src/core/game.js';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { OdysseyBotMatch } from '../../src/core/odyssey/OdysseyBotMatch.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function createMatch(authoredLevel = null, seed = 1234) {
    const levelConfig = authoredLevel ?? {
        id: 4,
        name: 'Chapter challenger',
        mechanics: {
            baseMode: 'standard',
            board: { rows: 20, startingRows: 0 },
            speed: { fixedDropInterval: 1000, startLevel: 1, levelProgression: false },
            versus: { botDifficulty: 1, fragsToWin: 7 },
        },
        modifiers: { active: [] },
        victory: {
            primary: { type: 'frags', target: 7 },
            failure: { type: 'opponent-frags', value: 7 },
            bonuses: [],
        },
        stars: { one: { frags: 7 }, two: { frags: 7, maxDeaths: 3 }, three: { frags: 7, maxDeaths: 1 } },
    };
    const hybridEngine = new GameplayHybridEngine();
    hybridEngine.configure(levelConfig);
    const session = { levelConfig, hybridEngine, gameState: hybridEngine.createGameState() };
    const onRoundStart = vi.fn();
    const match = new OdysseyBotMatch(session, { seed, isActive: () => !session.retired, onRoundStart });
    session.duel = match;
    fillBag(session.gameState.nextPieces, session.gameState.randomGenerator, session.gameState.pieceRandomizer);
    spawnPiece(session.gameState);
    match.prepareBot();
    return { match, session, onRoundStart };
}

async function resolveDeath(match, index, killer) {
    match.multiplayer.lastAttackerIds[index] = killer;
    match.markTopOut(index);
    match.update(100, 16, {});
    await match.transition;
}

function nextRound(match) {
    for (let frame = 0; frame < 18; frame++) match.update(1000 + frame * 50, 50, {});
}

const attackSummary = {
    totalLines: 4,
    comboStages: 1,
    manualColumns: [4],
    holeMask: Array.from({ length: 4 }, () => [false, false, false, false, true, false, false, false, false, false]),
};

describe('Odyssey beat-the-bot match', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it.each([[15001, 2], [1001, undefined]])(
        'keeps an authored, seeded judgment across rounds on %i',
        async (seed, threshold) => {
            // No shipped rival carries a judgment since level design pass 4; the setting stays supported.
            const level = structuredClone(getLevelById(56));
            level.mechanics.versus.botJudgment = {
                previewChance: 0.76, digPreviewChance: 1, variation: { chance: 0.35, judgment: { pressAtRows: 2 } },
            };
            const { match } = createMatch(level, seed);
            const style = match.bot.judgment;
            expect(style.pressAtRows).toBe(threshold);
            expect(style.digPreviewChance).toBe(1);
            await resolveDeath(match, 1, 0);
            nextRound(match);
            expect(match.round).toBe(2);
            expect(match.bot.judgment).toEqual(style);
            match.stop();
        },
    );

    it('replays the rival score and drops across display rates and different wall-clock origins', () => {
        const play = (hz, origin) => {
            const { match } = createMatch(getLevelById(60));
            match.setPaused(false, origin);
            const result = [];
            const update = match.bot.update.bind(match.bot);
            let tick = 0;
            match.bot.update = (delta, time) => {
                update(delta, time);
                tick++;
                if (tick % 60 === 0) {
                    result.push(match.players.map((p) => [
                        p.score, p.piecesPlaced, p.lines, p.currentPiece?.x, p.currentPiece?.y, p.dropCounter,
                        p.boardGrid.map((row) => row.map((c) => c?.type || '.').join('')).join('/'),
                    ]));
                }
            };
            let elapsed = 0;
            for (let frame = 0; elapsed < 30000 - 1e-6; frame++) {
                const delta = Math.min(30000 - elapsed, frame === 71 ? 50 : 1000 / hz);
                elapsed += delta;
                match.update(origin + elapsed, delta, {});
            }
            match.stop();
            expect(tick).toBe(1800);
            return result;
        };
        expect(play(165, 83454.789)).toEqual(play(60, 1234.567));
    });

    it('drives the canonical bot effects through actual accepted movement, rotation and lock physics', async () => {
        const { match } = createMatch();
        const bot = match.players[1];
        const effects = Object.fromEntries([
            'onMove', 'onRotate', 'onHardDrop', 'onPieceLock',
        ].map((name) => [name, vi.fn()]));
        match.setPresentation({ getBotCallbacks: () => effects });
        bot.isSeeking = true;
        expect(match.bot.actions.moveLeft()).toBe(true);
        expect(effects.onMove).toHaveBeenCalledWith(-1);
        expect(match.bot.actions.rotateRight()).toBe(true);
        expect(effects.onRotate).toHaveBeenCalledWith('right');
        expect(match.bot.actions.hardDrop()).toBe(true);
        await bot.latestPhysicsPromise;
        expect(effects.onHardDrop).toHaveBeenCalledOnce();
        expect(effects.onPieceLock).toHaveBeenCalledOnce();
        expect(bot.lockedPieces).toHaveLength(1);
    });

    it('plays incoming garbage and knockout feedback once on each actual victim', async () => {
        const { match } = createMatch();
        const human = { onGarbageApplied: vi.fn(), onTopOut: vi.fn() };
        const bot = { onGarbageApplied: vi.fn(), onTopOut: vi.fn() };
        match.setPresentation({ getHumanCallbacks: () => human, getBotCallbacks: () => bot });
        match.wrapHumanCallbacks({}).onGarbageReady(attackSummary);
        match.botCallbacks.spawnPiece();
        expect(bot.onGarbageApplied).toHaveBeenCalledWith(3);
        match.botCallbacks.onGarbageReady(attackSummary);
        match.wrapHumanCallbacks({}).spawnPiece();
        expect(human.onGarbageApplied).toHaveBeenCalledWith(3);
        match.markTopOut(0);
        match.markTopOut(0);
        match.markTopOut(1);
        expect(human.onTopOut).toHaveBeenCalledOnce();
        expect(bot.onTopOut).toHaveBeenCalledOnce();
        match.update(100, 16, {});
        await match.transition;
    });

    it.each([0, 1])('plays the seventh-frag celebration on winner %i before ending the round', async (winner) => {
        const { match } = createMatch();
        const effects = [0, 1].map(() => ({ onRoundWin: vi.fn(), onVictory: vi.fn() }));
        match.setPresentation({ getHumanCallbacks: () => effects[0], getBotCallbacks: () => effects[1] });
        match.multiplayer.frags[winner] = 6;
        await resolveDeath(match, 1 - winner, winner);
        expect(match.multiplayer.winner).toBe(winner);
        expect(effects[winner].onRoundWin).toHaveBeenCalledOnce();
        expect(effects[winner].onVictory).toHaveBeenCalledOnce();
        expect(effects[1 - winner].onVictory).not.toHaveBeenCalled();
        expect(match.roundActive).toBe(false);
    });

    it('renews bot visual callbacks after the renderer resets, fencing old rounds and retirement', async () => {
        const { match } = createMatch();
        const first = { onMove: vi.fn() };
        const second = { onMove: vi.fn() };
        let effects = first;
        match.setPresentation({ getBotCallbacks: () => effects });
        const old = match.botCallbacks;
        match.onRoundStart = () => { effects = second; };
        await resolveDeath(match, 1, null);
        nextRound(match);
        old.onMove(1);
        expect(first.onMove).not.toHaveBeenCalled();
        match.botCallbacks.onMove(1);
        expect(second.onMove).toHaveBeenCalledOnce();
        match.stop();
        match.botCallbacks.onMove(1);
        expect(second.onMove).toHaveBeenCalledOnce();
    });

    it('gives both boards identical seeded pieces, gravity, and attack rules', () => {
        const { match } = createMatch();
        const [human, bot] = match.players;
        // A live duel plays by the versus rules for pieces and locking, in both wells.
        expect([human.pieceRandomizer, bot.pieceRandomizer]).toEqual(['random', 'random']);
        expect([human.lockStyle, bot.lockStyle]).toEqual(['gravity', 'gravity']);
        expect(match.getSnapshot().botName).toBe('Challenger');
        expect(match.getResult().botName).toBe('Challenger');
        expect(human.currentPiece.shapeKey).toBe(bot.currentPiece.shapeKey);
        expect(human.nextPieces).toEqual(bot.nextPieces);
        expect(human.dropInterval).toBe(bot.dropInterval);
        expect(human.disableGarbage).toBe(false);
        expect(bot.suppressExternalInput).toBe(true);
        expect(human.suppressExternalInput).toBe(false);
    });

    it('keeps the authored challenger through round resets, final results and a retry', async () => {
        const level = getLevelById(5);
        const { match } = createMatch(level);
        expect(match.getSnapshot()).toMatchObject({ botName: 'Cinder', round: 1 });

        await resolveDeath(match, 1, 0);
        nextRound(match);
        expect(match.getSnapshot()).toMatchObject({ botName: 'Cinder', round: 2, playerFrags: 1 });

        match.multiplayer.frags[0] = 6;
        await resolveDeath(match, 1, 0);
        const completed = match.getResult();
        expect(completed).toMatchObject({ botName: 'Cinder', round: 2, playerFrags: 7 });
        match.stop();

        const { match: retry } = createMatch(level);
        expect(retry.getSnapshot()).toMatchObject({
            botName: 'Cinder', round: 1, playerFrags: 0, botFrags: 0,
        });
        expect(completed).toMatchObject({ botName: 'Cinder', round: 2, playerFrags: 7 });
        retry.stop();
    });

    it('routes real attacks and inserts garbage at the opponent floor before spawning', () => {
        const { match } = createMatch();
        const callbacks = match.wrapHumanCallbacks({});
        callbacks.onGarbageReady(attackSummary);
        expect(match.getSnapshot().botPendingGarbage).toBe(3);
        expect(match.multiplayer.lastAttackerIds[1]).toBe(0);
        match.botCallbacks.spawnPiece();
        expect(match.getSnapshot().botPendingGarbage).toBe(0);
        const rows = match.players[1].lockedPieces.filter((piece) => piece.isGarbage).map((piece) => piece.y);
        expect(rows).toEqual([21, 22, 23]);
    });

    it('sends an actual human quad through shared physics, metrics, and the opponent queue', async () => {
        vi.useFakeTimers();
        try {
            const { match, session } = createMatch();
            const human = match.players[0];
            applyGarbage(human, Array.from({ length: 4 }, () => ({ type: 'line', holeMask: 32 })));
            human.nextPieces.unshift('I');
            spawnPiece(human);
            rotate(human, 'right');
            const occupiedColumn = human.currentPiece.shape[0].findIndex(Boolean);
            human.currentPiece.x = 4 - occupiedColumn;
            const callbacks = match.wrapHumanCallbacks(session.hybridEngine.buildPhysicsCallbacks({}));
            hardDrop(human, null, callbacks);
            for (let tick = 1; tick <= 90 && human.isProcessingPhysics; tick++) {
                match.update(tick * (1000 / 60), 1000 / 60, callbacks);
            }
            expect(human.isProcessingPhysics).toBe(false);
            await human.latestPhysicsPromise;
            expect(session.hybridEngine.getMetrics().lines).toBe(4);
            expect(session.hybridEngine.getMetrics().quads).toBe(1);
            expect(match.getSnapshot().botPendingGarbage).toBeGreaterThanOrEqual(3);
            expect(match.multiplayer.lastAttackerIds[1]).toBe(0);
            expect(human.currentPiece).not.toBeNull();
        } finally { vi.useRealTimers(); }
    });

    it('gives the other player a self top-out and restarts with scores and deaths preserved', async () => {
        const { match, session, onRoundStart } = createMatch();
        const oldCallbacks = match.wrapHumanCallbacks({});
        match.players[0].score = 1200;
        await resolveDeath(match, 1, null);
        expect(match.multiplayer.frags).toEqual([1, 0]);
        expect(match.multiplayer.deaths).toEqual([0, 1]);
        expect(match.score).toBe(1200);
        nextRound(match);
        expect(match.round).toBe(2);
        expect(match.players[0]).toBe(session.gameState);
        expect(match.players[0].currentPiece.shapeKey).toBe(match.players[1].currentPiece.shapeKey);
        expect(match.players[0].nextPieces).toEqual(match.players[1].nextPieces);
        expect(match.players[0].rngDescriptor.seed).not.toBe(1234);
        expect(onRoundStart).toHaveBeenCalledOnce();
        oldCallbacks.onGarbageReady(attackSummary);
        expect(match.getSnapshot().botPendingGarbage).toBe(0);
    });

    it.each([0, 1])('ends only when player %i reaches seven credited frags', async (winner) => {
        const { match, session } = createMatch();
        for (let frag = 1; frag <= 7; frag++) {
            // Each frag must settle its round barrier before the next round starts.
            // eslint-disable-next-line no-await-in-loop
            await resolveDeath(match, 1 - winner, winner);
            expect(match.multiplayer.frags[winner]).toBe(frag);
            expect(match.multiplayer.isGameOver).toBe(frag === 7);
            if (frag < 7) nextRound(match);
        }
        expect(match.multiplayer.winner).toBe(winner);
        expect(session.hybridEngine.checkVictory()).toBe(winner === 0);
        expect(session.hybridEngine.checkFailure()).toBe(winner === 1);
        expect(match.getResult().playerFrags).toBe(winner === 0 ? 7 : 0);
    });

    it('waits for both cascades and resolves simultaneous seventh frags as a draw', async () => {
        const { match } = createMatch();
        const humanPhysics = deferred();
        const botPhysics = deferred();
        match.players[0].latestPhysicsPromise = humanPhysics.promise;
        match.players[1].latestPhysicsPromise = botPhysics.promise;
        match.multiplayer.frags = [6, 6];
        match.multiplayer.lastAttackerIds = [1, 0];
        match.markTopOut(0);
        match.update(100, 16, {});
        humanPhysics.resolve();
        await Promise.resolve();
        expect(match.multiplayer.isGameOver).toBe(false);
        match.markTopOut(1);
        botPhysics.resolve();
        await match.transition;
        expect(match.multiplayer.frags).toEqual([7, 7]);
        expect(match.multiplayer.winner).toBe(null);
        expect(match.multiplayer.isGameOver).toBe(true);
    });

    it('freezes both boards and the round break during pause, then reanchors both clocks', async () => {
        const { match } = createMatch();
        await resolveDeath(match, 0, 1);
        match.setPaused(true, 100);
        for (let frame = 0; frame < 40; frame++) match.update(10000 + frame * 50, 50, {});
        expect(match.round).toBe(1);
        expect(match.intermissionMs).toBe(900);
        expect(match.players.every((state) => state.isPaused)).toBe(true);
        match.setPaused(false, 12000);
        expect(match.players.every((state) => state.lastTime === 12000)).toBe(true);
        nextRound(match);
        expect(match.round).toBe(2);
        expect(match.players.every((state) => !state.isPaused)).toBe(true);
    });

    it('retirement during a round barrier prevents reset, attacks, and metric changes', async () => {
        const { match, session, onRoundStart } = createMatch();
        const physics = deferred();
        match.players[1].latestPhysicsPromise = physics.promise;
        const callbacks = match.botCallbacks;
        match.markTopOut(0);
        match.update(100, 16, {});
        session.retired = true;
        match.stop();
        physics.resolve();
        await match.transition;
        callbacks.onGarbageReady(attackSummary);
        nextRound(match);
        expect(match.multiplayer.deaths).toEqual([0, 0]);
        expect(match.multiplayer.frags).toEqual([0, 0]);
        expect(match.getSnapshot().playerPendingGarbage).toBe(0);
        expect(onRoundStart).not.toHaveBeenCalled();
        expect(match.players.every((state) => state.isStopped)).toBe(true);
    });

    it('drains the opponent even when human physics rejects, then surfaces the match failure', async () => {
        const { match } = createMatch();
        const humanPhysics = deferred();
        const botPhysics = deferred();
        match.players[0].latestPhysicsPromise = humanPhysics.promise;
        match.players[1].latestPhysicsPromise = botPhysics.promise;
        match.markTopOut(0);
        match.update(100, 16, {});
        const error = new Error('cascade rejected');
        humanPhysics.reject(error);
        await Promise.resolve();
        expect(match.error).toBeUndefined();
        botPhysics.resolve();
        await match.transition;
        expect(match.error).toBe(error);
        expect(match.stopped).toBe(true);
    });

    it('advances the actual bot through core placement and physics without human input', async () => {
        const { match } = createMatch();
        for (let frame = 0; frame < 100; frame++) {
            match.update(frame * 50, 50, {});
            // Each bot frame must settle placement physics before advancing again.
            // eslint-disable-next-line no-await-in-loop
            await match.players[1].latestPhysicsPromise;
        }
        expect(match.players[1].lockedPieces.length).toBeGreaterThan(0);
        expect(match.players[1].piecesPlaced).toBeGreaterThan(1);
        expect(match.players[0].lockedPieces).toHaveLength(0);
    });

    it('lets a Second Breath guard absorb the human top-out without touching the round or the bot', () => {
        const { match } = createMatch();
        const human = { onTopOut: vi.fn() };
        match.setPresentation({ getHumanCallbacks: () => human });
        match.topOutGuard = vi.fn(() => true);
        match.markTopOut(0);
        expect(match.topOutGuard).toHaveBeenCalledOnce();
        expect(match.pendingDeaths.size).toBe(0);
        expect(human.onTopOut).not.toHaveBeenCalled();
        expect(match.players[0].isPaused).toBe(false);
        // Spent: the next top-out is a knockout as usual, and the bot's never consults the guard.
        match.topOutGuard = vi.fn(() => false);
        match.markTopOut(1);
        expect(match.topOutGuard).not.toHaveBeenCalled();
        match.markTopOut(0);
        expect(match.topOutGuard).toHaveBeenCalledOnce();
        expect(match.pendingDeaths.has(0)).toBe(true);
        expect(human.onTopOut).toHaveBeenCalledOnce();
    });
});

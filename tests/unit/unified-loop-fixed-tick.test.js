import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { GameState } from '../../src/core/game.js';
import { UnifiedMultiplayerLoop } from '../../src/core/multiplayer/unified-game-loop.js';

function createFallingState() {
    const state = new GameState();
    state.currentPiece = {
        x: 3,
        y: 0,
        shape: [[1]],
        shapeKey: 'O',
    };
    state.dropInterval = state.simTickMs;
    return state;
}

function fixedLoopWith(state) {
    const loop = new UnifiedMultiplayerLoop();
    loop.players = [{
        id: 'player',
        state,
        physics: {},
        sound: null,
    }];
    return loop;
}

describe('UnifiedMultiplayerLoop fixed-tick player adapter', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('advances one canonical clock and one gravity step', () => {
        const state = createFallingState();
        const loop = fixedLoopWith(state);

        loop.updatePlayersFixedTick();

        expect(state.simFrame).toBe(1);
        expect(state.simTimeMs).toBeCloseTo(1000 / 60, 8);
        expect(state.currentPiece.y).toBe(1);
    });

    it('consumes hit-stop without advancing gravity', () => {
        const state = createFallingState();
        state.hitStopRemaining = 30;
        state.blindTimers.pending = 1;
        state.blindTimers.pendingMax = 1;
        const loop = fixedLoopWith(state);

        loop.updatePlayersFixedTick();

        expect(state.simFrame).toBe(1);
        expect(state.currentPiece.y).toBe(0);
        expect(state.hitStopTicks).toBe(1);
        expect(state.blindTimers.pendingTicks).toBe(59);
    });

    it('advances held input inside the tick after blind decay and before physics', () => {
        const state = createFallingState();
        state.blindTimers.pending = 1;
        state.blindTimers.pendingMax = 1;
        const loop = fixedLoopWith(state);
        const observed = [];

        loop.updatePlayersFixedTick((playerId, context) => {
            observed.push({
                playerId,
                tick: context.tick,
                blindTicks: state.blindTimers.pendingTicks,
                y: state.currentPiece.y,
            });
        });

        expect(observed).toEqual([{
            playerId: 'player',
            tick: 1,
            blindTicks: 59,
            y: 0,
        }]);
        expect(state.currentPiece.y).toBe(1);
    });

    it('applies commands inside the tick and reports their dispositions', () => {
        const state = createFallingState();
        state.blindTimers.pending = 1;
        state.blindTimers.pendingMax = 1;
        const loop = fixedLoopWith(state);
        const order = [];
        let tickResult = null;

        loop.updatePlayersFixedTick({
            advanceInput: (playerId, context) => {
                order.push(`advance:${playerId}:${state.simFrame}:${state.blindTimers.pendingTicks}`);
                context.emit({
                    tick: context.tick,
                    subframe: 0,
                    source: 'edge',
                    edgeSequence: 1,
                    action: 'move',
                    value: -1,
                });
            },
            applyInput: (playerId, command) => {
                order.push(`apply:${playerId}:${command.action}:${state.currentPiece.y}`);
                state.currentPiece.x += command.value;
                return true;
            },
            onTickResult: (playerId, result) => {
                order.push(`result:${playerId}:${result.input[0].disposition}:${state.currentPiece.y}`);
                tickResult = result;
            },
        });

        expect(order).toEqual([
            'advance:player:1:59',
            'apply:player:move:0',
            'result:player:applied:1',
        ]);
        expect(state.currentPiece.x).toBe(2);
        expect(tickResult.input).toHaveLength(1);
    });

    it('does not advance dead or game-over boards', () => {
        const dead = createFallingState();
        dead.isAlive = false;
        const gameOver = createFallingState();
        gameOver.isGameOver = true;
        const loop = new UnifiedMultiplayerLoop();
        loop.players = [
            {
                id: 'dead', state: dead, physics: {}, sound: null,
            },
            {
                id: 'over', state: gameOver, physics: {}, sound: null,
            },
        ];

        loop.updatePlayersFixedTick();

        expect(dead.simFrame).toBe(0);
        expect(gameOver.simFrame).toBe(0);
    });

    it('runs external simulation before render without reordering the legacy path', () => {
        vi.stubGlobal('requestAnimationFrame', vi.fn());
        const externalOrder = [];
        const external = new UnifiedMultiplayerLoop();
        external.externalPlayerUpdate = true;
        external.onUpdate = () => externalOrder.push('update');
        external.onRender = () => externalOrder.push('render');
        external.onStatsUpdate = () => externalOrder.push('stats');

        external.loop(16);

        expect(externalOrder).toEqual(['update', 'render', 'stats']);

        const legacyOrder = [];
        const legacy = new UnifiedMultiplayerLoop();
        legacy.updatePlayers = () => legacyOrder.push('players');
        legacy.onUpdate = () => legacyOrder.push('update');
        legacy.onRender = () => legacyOrder.push('render');
        legacy.onStatsUpdate = () => legacyOrder.push('stats');

        legacy.loop(16);

        expect(legacyOrder).toEqual(['players', 'render', 'stats', 'update']);
    });
});

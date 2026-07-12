import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { GameState } from '../../src/core/game.js';
import { runFfaFixedTicks } from '../../src/core/multiplayer/ffa-fixed-tick-runner.js';
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

function stubAnimationFrame() {
    const callbacks = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        callbacks.push(callback);
        return callbacks.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    return callbacks;
}

describe('UnifiedMultiplayerLoop fixed-tick player adapter', () => {
    afterEach(() => {
        vi.useRealTimers();
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

    it('keeps external rAF render-only without reordering the legacy path', () => {
        vi.stubGlobal('requestAnimationFrame', vi.fn());
        const externalOrder = [];
        const external = new UnifiedMultiplayerLoop();
        external.isRunning = true;
        external.externalPlayerUpdate = true;
        external.onUpdate = () => externalOrder.push('update');
        external.onRender = () => externalOrder.push('render');
        external.onStatsUpdate = () => externalOrder.push('stats');

        external.loop(16);

        expect(externalOrder).toEqual(['render', 'stats']);

        const legacyOrder = [];
        const legacy = new UnifiedMultiplayerLoop();
        legacy.isRunning = true;
        legacy.updatePlayers = () => legacyOrder.push('players');
        legacy.onUpdate = () => legacyOrder.push('update');
        legacy.onRender = () => legacyOrder.push('render');
        legacy.onStatsUpdate = () => legacyOrder.push('stats');

        legacy.loop(16);

        expect(legacyOrder).toEqual(['players', 'render', 'stats', 'update']);
    });

    it('drives external fixed updates from timeouts without an rAF callback', () => {
        vi.useFakeTimers();
        const frames = stubAnimationFrame();
        const loop = new UnifiedMultiplayerLoop();
        const updates = [];
        loop.setExternalPlayerUpdate(true, 10);
        loop.onUpdate = (time, delta) => updates.push({ time, delta });
        loop.onRender = vi.fn();

        loop.start();
        expect(frames).toHaveLength(1);
        expect(updates).toEqual([]);
        expect(loop.onRender).toHaveBeenCalledOnce();

        vi.advanceTimersByTime(35);

        expect(updates).toHaveLength(3);
        expect(updates.map(({ delta }) => delta)).toEqual([10, 10, 10]);
        expect(loop.onRender).toHaveBeenCalledOnce();
        loop.stop();
    });

    it('keeps fixed tick count independent from 30/60/144 Hz render callbacks', () => {
        vi.useFakeTimers();
        stubAnimationFrame();
        const rates = [30, 60, 144];
        const loops = rates.map(() => {
            const loop = new UnifiedMultiplayerLoop();
            const fixedSteps = vi.spyOn(loop, 'updatePlayersFixedTick').mockImplementation(() => {});
            const game = {
                unifiedLoop: loop,
                useJitterBuffer: true,
                _simTickAccumulatorMs: 0,
                SIM_TICK_MS: 1000 / 60,
                MAX_SIM_STEPS_PER_FRAME: 8,
                isHost: false,
                simTick: 0,
            };
            loop.setExternalPlayerUpdate(true);
            loop.onUpdate = (currentTime, delta) => {
                runFfaFixedTicks(game, delta, currentTime);
            };
            loop.start();
            return { loop, fixedSteps };
        });

        loops.forEach(({ loop }, index) => {
            const renderRate = rates[index];
            for (let frame = 1; frame <= renderRate; frame += 1) {
                loop.loop((frame * 1000) / renderRate, loop.runGeneration);
            }
        });
        vi.advanceTimersByTime(1000);

        const tickCounts = loops.map(({ fixedSteps }) => fixedSteps.mock.calls.length);
        expect(new Set(tickCounts).size).toBe(1);
        expect(tickCounts[0]).toBeGreaterThanOrEqual(59);
        loops.forEach(({ loop }) => loop.stop());
    });

    it('switches live ownership without double-updating or inheriting elapsed time', () => {
        vi.useFakeTimers();
        const frames = stubAnimationFrame();
        const loop = new UnifiedMultiplayerLoop();
        const updates = [];
        loop.updatePlayers = vi.fn();
        loop.onUpdate = (_time, delta) => updates.push({
            owner: loop.externalPlayerUpdate ? 'fixed' : 'legacy',
            delta,
        });
        loop.start();
        expect(updates).toEqual([{ owner: 'legacy', delta: 0 }]);

        loop.setExternalPlayerUpdate(true, 10);
        frames.shift()(5);
        expect(updates).toHaveLength(1);
        vi.advanceTimersByTime(10);
        expect(updates.at(-1)).toEqual({ owner: 'fixed', delta: 10 });

        loop.setExternalPlayerUpdate(false);
        vi.advanceTimersByTime(30);
        expect(updates).toHaveLength(2);
        frames.at(-1)(50);
        expect(updates.at(-1)).toEqual({ owner: 'legacy', delta: 40 });
        loop.stop();
    });

    it('stops paused time and keeps never-pause fixed simulation live', () => {
        vi.useFakeTimers();
        stubAnimationFrame();
        const loop = new UnifiedMultiplayerLoop();
        const updates = [];
        loop.setExternalPlayerUpdate(true, 10);
        loop.onUpdate = (_time, delta) => updates.push(delta);
        loop.start();
        vi.advanceTimersByTime(10);

        loop.pause();
        vi.advanceTimersByTime(50);
        expect(updates).toEqual([10]);
        loop.resume();
        vi.advanceTimersByTime(10);
        expect(updates).toEqual([10, 10]);

        loop.setNeverPause(true);
        loop.pause();
        vi.advanceTimersByTime(10);
        expect(updates).toEqual([10, 10, 10]);
        loop.stop();
    });

    it('invalidates queued timeout and rAF callbacks on stop', () => {
        const timers = [];
        const frames = stubAnimationFrame();
        vi.stubGlobal('setTimeout', vi.fn((callback) => {
            timers.push(callback);
            return timers.length;
        }));
        vi.stubGlobal('clearTimeout', vi.fn());
        const loop = new UnifiedMultiplayerLoop();
        loop.setExternalPlayerUpdate(true, 10);
        loop.onUpdate = vi.fn();
        loop.onRender = vi.fn();
        loop.start();
        const staleTimer = timers[0];
        const staleFrame = frames[0];

        loop.stop();
        staleTimer();
        staleFrame(10);

        expect(loop.onUpdate).not.toHaveBeenCalled();
        expect(loop.onRender).toHaveBeenCalledOnce();
        expect(timers).toHaveLength(1);
        expect(frames).toHaveLength(1);
    });

    it('invalidates the pre-scheduled fixed update when simulation throws', () => {
        const timers = [];
        stubAnimationFrame();
        vi.stubGlobal('setTimeout', vi.fn((callback) => {
            timers.push(callback);
            return timers.length;
        }));
        vi.stubGlobal('clearTimeout', vi.fn());
        const loop = new UnifiedMultiplayerLoop();
        const error = new Error('partial tick');
        loop.setExternalPlayerUpdate(true, 10);
        loop.onUpdate = vi.fn(() => {
            throw error;
        });
        loop.start();

        expect(() => timers[0]()).toThrow(error);
        expect(timers).toHaveLength(2);
        expect(clearTimeout).toHaveBeenCalledWith(2);

        timers[1]();

        expect(loop.onUpdate).toHaveBeenCalledOnce();
        expect(timers).toHaveLength(2);
        loop.stop();
    });
});

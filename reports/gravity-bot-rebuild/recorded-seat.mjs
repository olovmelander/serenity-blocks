import { processAutoDrop } from '../../src/core/game.js';
import { advanceTick } from '../../src/core/simulation-tick.js';
import { LocalBotManager } from '../../src/core/ai/local-bot-manager.js';
import { PuzzleBotController } from '../../src/core/ai/puzzle-bot-controller.js';
import { seededRandom } from '../../src/utils/helpers.js';
import { applyFixedHardDropHitStop, applyFixedLineImpactHitStop, applyFixedPerfectClearHitStop } from '../../src/core/fixed-hit-stop-policy.js';
import { applyLocalMultiplayerFixedCommand } from '../../src/core/game-modes/local-multiplayer-loop.js';
import { retireFixedCascade } from '../../src/core/physics.js';
import { deal, spawn } from '../bot-ai-audit-2026-11/solo.mjs';
import { notePlaced, prepareVersusBoard, takeGarbage, versusMatch, versusRules } from './shipped-versus.mjs';

// Display callbacks following a completed 60 Hz tick on an ideal refresh clock.
export function betweenTickFrames(hz, tick, prepare) {
    const first = Math.floor((tick - 1) * hz / 60);
    const next = Math.floor(tick * hz / 60);
    for (let frame = first + 1; frame < next; frame++) prepare(1000 / hz, 1000 / 60);
}

export function recordedSeat(tier, seed, onPieceLock, observers = {}) {
    const rules = versusRules(observers.rules);
    const state = deal(seed, (board) => prepareVersusBoard(board, rules));
    state.isSeeking = false;
    state.lockBonusPolicy = 'elapsed';
    state.useFixedCascade = true;
    state.hitStopEnabled = true;
    const match = versusMatch(2, { rules, matchConfig: { gameType: 'survivor' } });
    match.players[0] = state;
    match.sharedPieceSeed = seed;
    const queue = match.getGarbageQueue(0);
    const manager = new LocalBotManager({ multiplayerState: match,
        useLocalStyles: observers.useLocalStyles, actionFactory: () => ({}) });
    manager.configure([{ kind: 'bot', difficulty: tier }, { kind: 'human' }]);
    if (observers.control) {
        const { actions } = manager.controllers.get(0);
        manager.controllers.set(0, new PuzzleBotController({ actions, playerIndex: 0,
            playerState: state, difficulty: tier, rng: seededRandom((seed ^ 0x85ebca6b) >>> 0) }));
    }
    const callbacks = {
        onPieceLock: (...args) => { notePlaced(match, 0, rules); onPieceLock?.(...args); },
        onHardDrop: () => applyFixedHardDropHitStop(state),
        onLineClearImpact: lines => applyFixedLineImpactHitStop(state, lines),
        onLineClear: observers.onLineClear,
        onGarbageReady: summary => {
            match.handleGarbageSummary(0, summary);
            observers.onGarbageReady?.(summary);
        },
        onPerfectClear: () => applyFixedPerfectClearHitStop(state),
        spawnPiece: () => {
            if (takeGarbage(state, queue, { rules, onGarbageReady: callbacks.onGarbageReady }).topOut) {
                state.isGameOver = true;
                return;
            }
            spawn(state);
        },
    };
    return { state, bot: manager.controllers.get(0), queue,
        precompute: (elapsedMs, tickMs) => manager.precomputeFixedSearch(elapsedMs, tickMs),
        step: () => advanceTick(state, {
            advanceInput: context => manager.advanceFixedInput(0, context),
            applyInput: cmd => applyLocalMultiplayerFixedCommand(cmd, {
                gameState: state, isEnabled: () => true, physicsCallbacks: callbacks,
            }),
            advancePhysics: dt => processAutoDrop(state, dt, null, callbacks, { fixedTick: true }),
        }),
        close: () => { state.isStopped = true; retireFixedCascade(state); manager.destroy(); state.reset(); } };
}

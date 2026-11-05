/**
 * A replay holds accepted commands only, on the frame each was accepted. A key that lands just
 * after a hard drop's hit-stop is over can round to a frame still inside the replay's hit-stop,
 * which counts in whole ticks. The replay refused it, the command was gone, and the piece landed
 * elsewhere: on 100, 165 and 200 Hz displays, replays quietly showed a different game.
 *
 * Real SinglePlayerMode, real recorder and player, simulated displays.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
vi.mock('../../src/ui/next-queue-ui.js', () => ({ updateNextQueue: vi.fn() }));

const { SinglePlayerMode } = await import('../../src/core/game-modes/SinglePlayerMode.js');
const {
    GameState, updateGame, fillBag, spawnPiece,
} = await import('../../src/core/game.js');
const { bindLegacySessionRng } = await import('../../src/core/session-rng.js');
const { computeBoardDigest } = await import('../../src/core/demo/demo-state.js');
const { DemoPlayer } = await import('../../src/core/demo/DemoPlayer.js');
const { DEMO_LEGACY_SIMULATION_CLOCK } = await import('../../src/core/demo/DemoRecorder.js');

const silent = new Proxy({}, { get: () => () => {} });

function makeMode(hitStopEnabled = true) {
    const mode = new SinglePlayerMode({
        settingsManager: { get: () => ({}) },
        soundManager: { sfxPlayer: silent },
        themeManager: silent,
    });
    mode.isActive = true;
    mode.isRunning = true;
    const gameState = new GameState({ hitStopEnabled });
    mode.gameState = gameState;
    mode._sessionGeneration = 1;
    mode._activeSession = Object.freeze({
        generation: 1, gameState, simulationClock: DEMO_LEGACY_SIMULATION_CLOCK, rngDescriptor: null,
    });
    mode._getBoardScene = () => null;
    mode._refreshNextQueue = () => {};
    return mode;
}

/** A run on a display of `hz`, with each move pressed on the first frame after a hit-stop. */
async function record(hz, seed, pieces) {
    const mode = makeMode();
    const { gameState } = mode;
    bindLegacySessionRng(gameState, seed);
    fillBag(gameState.nextPieces, gameState.randomGenerator);
    gameState.isSeeking = true; // physics skips its waits: there is no wall clock in here
    spawnPiece(gameState, null, () => {});
    mode.isRecording = true;
    mode.demoRecorder.startRecording(gameState, {}, seed, 'single-player', DEMO_LEGACY_SIMULATION_CLOCK);

    const callbacks = { physicsCallbacks: mode._getPhysicsCallbacks(), playDropCallback: () => {} };
    const frame = 1000 / hz;
    let now = seed % 17;
    gameState.lastTime = 0;
    const step = async () => {
        now += frame;
        updateGame(now, gameState, callbacks);
        await gameState.latestPhysicsPromise;
    };

    let accepted = 0;
    for (let placed = 0; placed < pieces && !gameState.isGameOver; placed += 1) {
        // eslint-disable-next-line no-await-in-loop -- one simulated frame after another
        while (gameState.hitStopRemaining > 0 || !gameState.currentPiece) await step();
        if (mode._applyCommand({ type: 'move', value: (seed + placed) % 2 ? 1 : -1 })) accepted += 1;
        await step();
        mode._applyCommand({ type: 'hardDrop' });
        // eslint-disable-next-line no-await-in-loop -- one simulated frame after another
        await gameState.latestPhysicsPromise;
    }

    const demo = mode.demoRecorder.stopRecording({
        score: gameState.score, lines: gameState.lines, level: gameState.level,
    });
    return {
        accepted,
        demo: JSON.parse(JSON.stringify(demo)),
        digest: computeBoardDigest(gameState.boardGrid),
    };
}

async function replay(demo) {
    const mode = makeMode(demo.initialState.settings.hitStopEnabled);
    mode.isPlayingDemo = true;
    const { gameState } = mode;
    const player = new DemoPlayer({});
    expect(player.loadDemo(demo)).toBe(true);

    let refused = 0;
    const physicsCallbacks = mode._getPhysicsCallbacks();
    player.gameState = gameState;
    player.callbacks = {
        ...physicsCallbacks,
        spawnPiece: () => spawnPiece(gameState, null, undefined),
        applyCommand: (command, options = {}) => {
            const applied = mode._applyCommand(command, { ...options, record: false });
            if (!applied) refused += 1;
            return applied;
        },
        replayTimingCallbacks: {
            onHardDrop: () => mode._applyHardDropTiming(),
            onLineClearImpact: (lines) => mode._applyLineClearImpactTiming(lines),
            onPerfectClear: () => mode._applyPerfectClearTiming?.(),
        },
        playDropCallback: () => {},
        playSoundCallback: () => {},
        addTrailCallback: () => {},
        physicsCallbacks,
    };
    player.isPlaying = true;
    player.seekToken = 1;
    player._resetState();
    await player._advanceTo(player.getDuration(), { muted: false, seeking: true, token: 1 });
    return { digest: computeBoardDigest(gameState.boardGrid), refused };
}

describe('a replay on any display', () => {
    it.each([60, 100, 120, 144, 165, 200, 240])('shows the game that was played at %i Hz', async (hz) => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.stubGlobal('document', { getElementById: () => null, querySelector: () => null });

        const outcomes = [];
        for (let seed = 1; seed <= 6; seed += 1) {
            // eslint-disable-next-line no-await-in-loop -- one game after another
            const recorded = await record(hz, seed * 7919, 10);
            expect(recorded.accepted).toBeGreaterThan(0);
            // eslint-disable-next-line no-await-in-loop -- one game after another
            const replayed = await replay(recorded.demo);
            outcomes.push({ refused: replayed.refused, same: replayed.digest === recorded.digest });
        }

        expect(outcomes).toEqual(outcomes.map(() => ({ refused: 0, same: true })));

        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });
});

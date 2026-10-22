/**
 * Local versus: the match is judged on match totals by the mode, at every death and while
 * the round runs, and its clocks stop with a pause.
 *
 * Before: MultiPlayerState judged a match on one round's counters at every death, so a 3-4
 * player frag goal could stop the loop with two players alive and no result; points, lines
 * and time were only checked when someone died and went to the round's survivor; a pause
 * taken during the countdown was undone at "Go"; Hot Potato counted the countdown and every
 * pause; every piece took the full lock bonus; the results card showed the last round's frags.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { LocalMultiplayerMode, ROUND_OUTCOME_MS } from '../../src/core/game-modes/LocalMultiplayerMode.js';
import { startLocalMultiplayerModeLoop } from '../../src/core/game-modes/local-multiplayer-loop.js';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';

const moduleMocks = vi.hoisted(() => ({
    spawnPiece: vi.fn(),
    transitionCountdown: vi.fn(),
    showLocalMatchEnd: vi.fn(),
}));

vi.mock('phaser', () => ({
    default: { Game: vi.fn(), WEBGL: 'webgl', Scale: { FIT: 1, CENTER_BOTH: 1 } },
}));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: vi.fn() }));
vi.mock('../../src/ui/cinematic-loading-overlay.js', () => ({
    dismissCinematicLoadingOverlay: vi.fn(() => Promise.resolve()),
    showCinematicLoadingOverlay: vi.fn(),
    waitForCinematicLoadingOverlayPresented: vi.fn(() => Promise.resolve()),
    transitionCinematicLoadingOverlayToCountdown: moduleMocks.transitionCountdown,
    setCinematicLoadingProgress: vi.fn(),
}));
vi.mock('../../src/ui/intro-animation.js', () => ({ introAnimation: { dismiss: vi.fn() } }));
vi.mock('../../src/ui/local-match-end-overlay.js', () => ({ showLocalMatchEnd: moduleMocks.showLocalMatchEnd }));
vi.mock('../../src/core/game.js', async () => ({
    ...await vi.importActual('../../src/core/game.js'),
    spawnPiece: moduleMocks.spawnPiece,
}));

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    moduleMocks.transitionCountdown.mockReset();
    moduleMocks.showLocalMatchEnd.mockReset();
});

/** A mode mid-match on the legacy (rAF) loop, with the result screens stubbed. */
function matchMode(numPlayers, config) {
    const mode = Object.create(LocalMultiplayerMode.prototype);
    mode.isRunning = true;
    mode.isPaused = false;
    mode.matchConfig = { isInfinityLMS: false, numPlayers, ...config };
    mode.multiplayerState = new MultiPlayerState(numPlayers);
    mode.multiplayerState.setMatchConfig(mode.matchConfig);
    mode.multiplayerState.reset();
    mode.matchStats = {};
    mode.matchStartTime = Date.now();
    mode._localSimulationLoop = { fixedTickEnabled: false, transitionGeneration: 1 };
    mode._showPlayerDeathAnimation = vi.fn();
    mode._showVictoryAnimation = vi.fn();
    mode._showMatchEnd = vi.fn(() => Promise.resolve());
    mode._startNewRound = vi.fn(() => Promise.resolve());
    mode.handleRoundEnd = vi.fn(() => Promise.resolve());
    return mode;
}

describe('a frag goal counts kills, not rounds', () => {
    it('ends a four-player match the moment a kill reaches the goal, with two still alive', async () => {
        vi.useFakeTimers();
        const mode = matchMode(4, { endCondition: 'frags', endConditionValue: 1 });
        mode.multiplayerState.lastAttackerIds[2] = 0;

        const outcome = mode._handleGameOver(2);
        await vi.advanceTimersByTimeAsync(ROUND_OUTCOME_MS);
        await outcome;

        // The state no longer stops the loop on a round's counters...
        expect(mode.multiplayerState.isGameOver).toBe(false);
        // ...the mode ends the match, and the result is shown.
        expect(mode._showMatchEnd).toHaveBeenCalledWith('player1');
        expect(mode.handleRoundEnd).not.toHaveBeenCalled();
    });

    it('counts frags from earlier rounds', async () => {
        vi.useFakeTimers();
        const mode = matchMode(3, { endCondition: 'frags', endConditionValue: 3 });
        mode.matchStats.player2 = { frags: 2 };
        mode.multiplayerState.lastAttackerIds[0] = 1;

        const outcome = mode._handleGameOver(0);
        await vi.advanceTimersByTimeAsync(ROUND_OUTCOME_MS);
        await outcome;

        expect(mode._showMatchEnd).toHaveBeenCalledWith('player2');
    });

    it('lets the round go on while no one has reached the goal', async () => {
        vi.useFakeTimers();
        const mode = matchMode(4, { endCondition: 'frags', endConditionValue: 7 });
        mode.multiplayerState.lastAttackerIds[3] = 1;

        await mode._handleGameOver(3);
        await vi.advanceTimersByTimeAsync(ROUND_OUTCOME_MS);

        expect(mode._showMatchEnd).not.toHaveBeenCalled();
        expect(mode.multiplayerState.isPaused).toBe(false);
    });
});

describe('points, lines and time end a match mid-round, to the leader', () => {
    it('points: the highest match score wins, not the player who crossed the line', async () => {
        vi.useFakeTimers();
        const mode = matchMode(3, { endCondition: 'points', endConditionValue: 1 });
        mode.matchStats.player1 = { score: 500 };
        mode.multiplayerState.players[0].score = 900; // 1,400 over the match
        mode.multiplayerState.players[2].score = 1200; // crossed 1,000 this round

        mode._checkMatchEndMidRound();
        expect(mode.multiplayerState.isPaused).toBe(true);
        await vi.advanceTimersByTimeAsync(ROUND_OUTCOME_MS);

        expect(mode._showMatchEnd).toHaveBeenCalledWith('player1');
    });

    it('lines: the goal met without anyone dying', async () => {
        vi.useFakeTimers();
        const mode = matchMode(2, { endCondition: 'lines', endConditionValue: 40 });
        mode.multiplayerState.players[1].lines = 40;

        mode._checkMatchEndMidRound();
        await vi.advanceTimersByTimeAsync(ROUND_OUTCOME_MS);

        expect(mode._showMatchEnd).toHaveBeenCalledWith('player2');
    });

    it('time: the clock runs out with nobody dying, and a tie is a draw', async () => {
        vi.useFakeTimers();
        const mode = matchMode(2, { endCondition: 'time', endConditionValue: 3 });
        mode.matchStartTime = Date.now() - 3 * 60000;
        mode.multiplayerState.players[0].score = 700;
        mode.multiplayerState.players[1].score = 700;

        mode._checkMatchEndMidRound();
        mode._checkMatchEndMidRound(); // a second check while it ends changes nothing
        await vi.advanceTimersByTimeAsync(ROUND_OUTCOME_MS);

        expect(mode._showMatchEnd).toHaveBeenCalledOnce();
        expect(mode._showMatchEnd).toHaveBeenCalledWith('draw');
    });

    it('does nothing while the game is paused or before the goal', () => {
        const mode = matchMode(2, { endCondition: 'lines', endConditionValue: 40 });
        mode.multiplayerState.players[1].lines = 39;
        mode._checkMatchEndMidRound();
        mode.multiplayerState.players[1].lines = 40;
        mode.isPaused = true;
        mode._checkMatchEndMidRound();
        expect(mode.multiplayerState.isPaused).toBe(false);
        expect(mode._matchEnding).toBeFalsy();
    });

    it('a team race sums its players', () => {
        const mode = matchMode(4, {
            endCondition: 'points', endConditionValue: 2, isTeamMode: true, playerTeams: [0, 0, 1, 1],
        });
        mode._getResolvedTeamId = (index) => mode.matchConfig.playerTeams[index];
        mode.multiplayerState.players[0].score = 1100;
        mode.multiplayerState.players[1].score = 1000;
        mode.multiplayerState.players[2].score = 1500;
        expect(mode._resolveMatchEnd()).toEqual({ type: 'team', teamId: 0 });
    });
});

describe('a pause stops the match', () => {
    it('a pause taken during the countdown still holds when play starts', async () => {
        let resolveCountdown;
        moduleMocks.transitionCountdown.mockImplementation(() => new Promise((resolve) => {
            resolveCountdown = resolve;
        }));
        vi.stubGlobal('document', { getElementById: vi.fn(() => null) });
        const mode = new LocalMultiplayerMode({
            modalManager: { hideAll: vi.fn() },
            soundManager: { sfxPlayer: { playDrop: vi.fn(), playMove: vi.fn() } },
            themeManager: {},
        });
        mode.isActive = true;
        mode.configuredForStart = true;
        mode.matchConfig = { numPlayers: 2, hotPotato: true };
        mode.boardScenes = [{}];
        mode.roundStartTime = 123; // the previous match's last round
        for (const name of [
            '_activatePhaserMultiplayerUI', '_clearDeathAnimations', '_destroyMinimaps',
            '_hideMultiplayerBoardsForCountdown', '_revealMultiplayerBoardsForCountdown',
            '_setupInputWrappers', '_setupLocalBots', '_startGameLoop', '_syncBoardScenes',
            '_updateMultiplayerStats',
        ]) mode[name] = vi.fn();
        mode._waitForMatchStartLoadingOverlayMinVisible = vi.fn(() => Promise.resolve());

        const started = mode.onStart({ seed: 0 });
        await vi.waitFor(() => expect(moduleMocks.transitionCountdown).toHaveBeenCalledOnce());
        mode.onPause(); // Settings opened (or the window lost focus) during the countdown
        const beforeGo = Date.now();
        resolveCountdown();
        await started;

        expect(mode._startGameLoop).toHaveBeenCalledOnce();
        expect(mode.multiplayerState.isPaused).toBe(true);
        expect(mode.roundStartTime).toBeGreaterThanOrEqual(beforeGo);
        expect(mode.matchStartTime).toBe(mode.roundStartTime);
        const potato = mode.multiplayerState.hotPotato;
        expect(potato.enabled).toBe(true);
        expect(potato.expiresAt - potato.durationMs).toBeGreaterThanOrEqual(beforeGo);

        mode.onResume();
        expect(mode.multiplayerState.isPaused).toBe(false);
    });

    it('moves the match clock, the round clock and the Hot Potato on by the pause', () => {
        vi.useFakeTimers();
        vi.setSystemTime(100000);
        const mode = matchMode(2, { endCondition: 'time', endConditionValue: 3, hotPotato: true });
        mode.matchStartTime = 40000;
        mode.roundStartTime = 90000;
        mode.multiplayerState.startHotPotatoClock(95000);
        const { expiresAt } = mode.multiplayerState.hotPotato;

        mode.onPause();
        vi.setSystemTime(130000); // 30 s in Settings
        mode.onResume();

        expect(mode.matchStartTime).toBe(70000);
        expect(mode.roundStartTime).toBe(120000);
        expect(mode.multiplayerState.hotPotato.expiresAt).toBe(expiresAt + 30000);
        expect(mode.multiplayerState.updateHotPotato(130000)).toBeNull(); // not detonated
    });

    it('a round that began during the pause is timed from the resume', () => {
        vi.useFakeTimers();
        vi.setSystemTime(100000);
        const mode = matchMode(2, { endCondition: 'frags', endConditionValue: 7 });
        mode.matchStartTime = 10000;
        mode.onPause();
        mode.roundStartTime = 105000; // the next round began behind the pause sheet
        vi.setSystemTime(130000);
        mode.onResume();

        expect(mode.roundStartTime).toBe(130000);
        expect(mode.matchStartTime).toBe(40000);
    });
});

describe('the legacy loop advances each player\'s sim clock (the lock bonus)', () => {
    it('counts frame time for living, unpaused players only', () => {
        const frames = [];
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frames.push(callback); return frames.length; }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.stubGlobal('window', {});
        const mode = matchMode(3, { endCondition: 'frags', endConditionValue: 7 });
        mode.deps = { soundManager: { sfxPlayer: { playDrop: vi.fn() } } };
        mode._updateMultiplayerStats = vi.fn();
        mode._syncBoardScenes = vi.fn();
        mode.multiplayerState.players.forEach((player) => { player.currentPiece = null; });
        mode.multiplayerState.players[1].isAlive = false;
        mode.multiplayerState.playerPaused[2] = true;
        mode.multiplayerState.lastTime = 1000;

        startLocalMultiplayerModeLoop(mode);
        frames.at(-1)(1016);
        frames.at(-1)(1048);

        expect(mode.multiplayerState.players.map((player) => player.simTimeMs)).toEqual([48, 0, 0]);
    });
});

describe('the results card', () => {
    it('shows the frags of the whole match', async () => {
        const mode = matchMode(2, { endCondition: 'frags', endConditionValue: 3 });
        mode.matchStats.player1 = { frags: 2, score: 0, lines: 0 };
        mode.multiplayerState.frags[0] = 1;
        mode._showMatchEnd = LocalMultiplayerMode.prototype._showMatchEnd;
        mode._playVictoryBeat = vi.fn(() => Promise.resolve(true));
        mode.onStop = vi.fn(() => Promise.resolve());
        mode._getPlayerColorScheme = vi.fn(() => ({ primary: '#fff' }));
        mode._startGeneration = 1;

        await mode._showMatchEnd('player1');

        const { players } = moduleMocks.showLocalMatchEnd.mock.calls[0][0];
        expect(players[0].frags).toBe(3);
    });
});

describe('local-match-rules.js', () => {
    it('judges each rule by its own measure and leaves round-win rules alone', async () => {
        const { resolveLocalMatchEnd } = await import('../../src/core/game-modes/local-match-rules.js');
        const standings = [
            { result: 'player1', frags: 2, score: 4000, lines: 10 },
            { result: 'player2', frags: 1, score: 5200, lines: 12 },
        ];
        expect(resolveLocalMatchEnd({ endCondition: 'frags', endConditionValue: 2 }, standings, 0)).toBe('player1');
        expect(resolveLocalMatchEnd({ endCondition: 'points', endConditionValue: 5 }, standings, 0)).toBe('player2');
        expect(resolveLocalMatchEnd({ endCondition: 'lines', endConditionValue: 13 }, standings, 0)).toBeNull();
        expect(resolveLocalMatchEnd({ endCondition: 'time', endConditionValue: 2 }, standings, 119999)).toBeNull();
        expect(resolveLocalMatchEnd({ endCondition: 'time', endConditionValue: 2 }, standings, 120000)).toBe('player2');
        expect(resolveLocalMatchEnd({ endCondition: 'never', endConditionValue: 1 }, standings, 1e9)).toBeNull();
        expect(resolveLocalMatchEnd({ endCondition: 'frags', endConditionValue: 1 }, [], 0)).toBeNull();
    });

    it('moves a clock on only by the part of a pause after it started', async () => {
        const { resumeClock } = await import('../../src/core/game-modes/local-match-rules.js');
        expect(resumeClock(1000, 500, 5000)).toBe(1500);
        expect(resumeClock(4800, 500, 5000)).toBe(5000);
        expect(resumeClock(6000, 500, 5000)).toBe(6000);
    });
});

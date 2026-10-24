/**
 * Autoplay for trailer footage, bundled by capture.mjs (esbuild, IIFE) and injected into the
 * running game as `window.__trailerAutoplay`. It is the game's own CPU opponent
 * (PuzzleBotController) driving the human's board through the same entry points the keyboard
 * uses (window.move / rotate / softDrop / hardDrop), ticked from requestAnimationFrame so it
 * follows the virtual clock frame by frame.
 *
 * Bundled separately from the app, it only reads the app's GameState as data and talks to it
 * through those globals.
 */
import { PuzzleBotController } from '../../src/core/ai/puzzle-bot-controller.js';
import { BotInputScheduler } from '../../src/core/ai/bot-input-scheduler.js';
import { getBotDifficultyConfig } from '../../src/core/ai/bot-difficulty.js';
import { applyPlacement, createRun, solutionPlacement } from '../../src/core/stillfall/stillfall-sim.js';
import { solveFrom } from '../../src/core/stillfall/stillfall-solver.js';

const mulberry32 = (seed) => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/** What changes when a piece is placed (the bot's own notion of a new spawn). */
const spawnToken = (gs) => {
    if (Number.isFinite(gs?.piecesPlaced)) return `count:${gs.piecesPlaced}`;
    if (Number.isFinite(gs?.pieceSpawnTime)) return `time:${gs.pieceSpawnTime}`;
    return gs?.currentPiece ?? null;
};

const ACTIONS = {
    moveLeft: () => window.move(-1),
    moveRight: () => window.move(1),
    rotateLeft: () => window.rotate('left'),
    rotateRight: () => window.rotate('right'),
    rotateFlip: () => window.rotate('flip'),
    softDrop: () => window.softDrop(),
    hardDrop: () => { window.hardDrop(); return true; },
};

const perform = (action) => {
    switch (action.type) {
    case 'move': return action.dir === 'left' || action.dir < 0 ? ACTIONS.moveLeft() : ACTIONS.moveRight();
    case 'rotate':
        if (action.dir === 'left') return ACTIONS.rotateLeft();
        if (action.dir === 'flip') return ACTIONS.rotateFlip();
        return ACTIONS.rotateRight();
    case 'softDrop': return ACTIONS.softDrop();
    case 'hardDrop': return ACTIONS.hardDrop();
    default: return false;
    }
};

let running = null;
/** The last start(), for resume(). */
let lastStart = null;

function currentMode() {
    return window.serenityBlocks?.gameModeManager?.getCurrentMode?.() ?? null;
}

function liveState(mode) {
    // Online versus: the local player's predicted board (the inputs go to the host).
    const online = mode?.ffaGameState?.getLocalPlayer?.()?.gameState;
    if (online) return online;
    return mode?.getGameState?.() ?? mode?.gameState ?? null;
}

// Prefill runs while the clock is thawed and a themed frame can take seconds to draw, so it
// waits on the event loop, not on frames.
const yieldTask = () => new Promise((resolve) => {
    if (window.__trailerClock) window.__trailerClock.realSleep(4).then(resolve);
    else setTimeout(resolve, 4);
});

window.__trailerAutoplay = {
    /**
     * Start the bot on the current mode's board. `difficulty` 1–10 (10: ~1800 actions a minute
     * and no hesitation; 7–8 reads as a strong human).
     */
    start({ difficulty = 8, seed = 1337 } = {}) {
        this.stop();
        lastStart = { difficulty, seed };
        const mode = currentMode();
        const rng = mulberry32(seed);
        const bot = new PuzzleBotController({
            playerIndex: 0, playerState: liveState(mode), difficulty, rng, actions: ACTIONS,
        });
        let last = null;
        const state = { bot, raf: 0, stopped: false };
        const tick = (now) => {
            if (state.stopped) return;
            const gs = liveState(currentMode());
            if (gs && bot.playerState !== gs) {
                bot.playerState = gs;
                bot.reset();
            }
            if (last !== null && gs) bot.update(Math.min(100, now - last), now);
            last = now;
            state.raf = requestAnimationFrame(tick);
        };
        state.raf = requestAnimationFrame(tick);
        running = state;
        return true;
    },
    /**
     * Stillfall: play the puzzle's stored solution (or the solver's line from here), one piece
     * at a time, pausing `thinkMs` over each choice the way the mode invites you to.
     */
    startStillfall({ difficulty = 6, thinkMs = 650 } = {}) {
        this.stop();
        const scheduler = new BotInputScheduler(ACTIONS, getBotDifficultyConfig(difficulty));
        const state = { raf: 0, stopped: false };
        let last = null;
        let token = null;
        let readyAt = 0;
        let planned = false;
        const tick = (now) => {
            if (state.stopped) return;
            const mode = currentMode();
            const gs = liveState(mode);
            if (last !== null && gs?.currentPiece && !gs.isProcessingPhysics && mode?.puzzle) {
                // One plan per piece dealt (rotating the piece must not count as a new one).
                const pieceToken = String(mode._dealt);
                if (pieceToken !== token) {
                    token = pieceToken;
                    planned = false;
                    readyAt = now + thinkMs;
                    scheduler.clear();
                }
                if (!planned && now >= readyAt) {
                    planned = true;
                    const run = mode._liveRun();
                    const step = mode.puzzle.solution?.[mode._dealt];
                    const placement = (step && solutionPlacement(run, step)) || solveFrom(run)?.[0];
                    if (placement) scheduler.setActions([...placement.actions, { type: 'hardDrop' }]);
                }
                scheduler.update(Math.min(100, now - last));
            }
            last = now;
            state.raf = requestAnimationFrame(tick);
        };
        state.raf = requestAnimationFrame(tick);
        running = state;
        return true;
    },
    /**
     * Stillfall: load `puzzle` from the bank and set the board to where the first `steps` moves
     * of its stored solution leave it, so the shot opens on the decisive piece. The position is
     * worked out with the mode's own pure simulator and restored as a turn, as undo restores one.
     */
    async prepareStillfall({ puzzle, steps = 0 } = {}) {
        const mode = currentMode();
        if (!mode?._loadPuzzle) return { error: 'not in Stillfall' };
        if (puzzle) mode._loadPuzzle(puzzle);
        let run = createRun(mode.puzzle);
        for (let step = 0; step < steps; step += 1) {
            const placement = solutionPlacement(run, mode.puzzle.solution[step]);
            if (!placement) break;
            ({ run } = applyPlacement(run, placement));
        }
        if (run.dealt > 0) {
            mode._restoreTurn({
                lockedPieces: run.lockedPieces,
                nextPieces: mode.puzzle.supply.slice(run.dealt),
                pieceIdCounter: run.nextPieceId - 1,
                lines: run.lines,
                bestWaves: run.bestWaves,
                dealt: run.dealt,
            });
        }
        await yieldTask();
        return { dealt: mode._dealt, puzzle: mode.puzzle?.id ?? null, outcome: run.outcome };
    },
    /** Stop the board bot while the game is held (a world flip); resume() starts it again. */
    pause() {
        if (running?.bot) this.stop();
    },
    resume() {
        if (!running && lastStart) this.start(lastStart);
    },
    stop() {
        if (!running) return;
        running.stopped = true;
        cancelAnimationFrame(running.raf);
        running = null;
    },
    /**
     * Grow a mid-game stack before recording: the bot places `pieces` pieces at once (its plan
     * applied immediately, the hard drop's animations skipped as a replay seek skips them), so
     * a shot opens on a lived-in board instead of an empty well. Stops early if the stack gets
     * taller than `maxHeight` rows.
     */
    async prefill({
        pieces = 18, difficulty = 9, seed = 7, maxHeight = 9,
    } = {}) {
        const mode = currentMode();
        const rng = mulberry32(seed);
        const bot = new PuzzleBotController({
            playerIndex: 0, playerState: liveState(mode), difficulty, rng, actions: ACTIONS,
        });
        let placed = 0;
        for (let guard = 0; guard < pieces * 400 && placed < pieces; guard += 1) {
            const gs = liveState(currentMode());
            if (!gs || gs.isGameOver) break;
            if (!gs.currentPiece || gs.isProcessingPhysics) {
                // eslint-disable-next-line no-await-in-loop
                await yieldTask();
                continue;
            }
            bot.playerState = gs;
            gs.isSeeking = true;
            // The hit-stop after a lock is a beat of drama, ticked down by frames: with a themed
            // frame taking seconds, it would swallow every input of the next piece.
            if (gs.hitStopRemaining > 0) gs.hitStopRemaining = 0;
            const before = spawnToken(gs);
            const plan = bot.plan();
            if (!plan) break;
            plan.actions.forEach((action) => { if (action.type !== 'hardDrop') perform(action); });
            ACTIONS.hardDrop();
            // eslint-disable-next-line no-await-in-loop
            if (gs.latestPhysicsPromise) await gs.latestPhysicsPromise.catch(() => {});
            gs.isSeeking = false;
            if (spawnToken(gs) === before && gs.currentPiece) {
                // The drop was refused (the game was between states): try this piece again.
                // eslint-disable-next-line no-await-in-loop
                await yieldTask();
                continue;
            }
            placed += 1;
            const grid = gs.boardGrid || gs.board;
            const rows = Array.isArray(grid) ? grid : [];
            const firstFilled = rows.findIndex((row) => Array.isArray(row) && row.some(Boolean));
            const height = firstFilled < 0 ? 0 : rows.length - firstFilled;
            if (height > maxHeight + 4) break; // grid includes hidden rows
            // eslint-disable-next-line no-await-in-loop
            await yieldTask();
        }
        const gs = liveState(currentMode());
        if (gs) gs.isSeeking = false;
        return placed;
    },
};

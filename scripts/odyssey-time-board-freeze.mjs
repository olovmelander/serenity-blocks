// @ts-check
/**
 * The rules freeze for Odyssey orb time boards.
 *
 * A time board only means something while every time on it was set on the same orb. This script
 * takes a fingerprint of each timed orb and pins it beside the name of the board the orb races
 * on. tests/unit/odyssey-time-board-freeze.test.js fails when an orb's fingerprint moves while
 * its board name stays, so nobody changes an orb under a public board without deciding to.
 *
 *   node scripts/odyssey-time-board-freeze.mjs           re-pin (writes the pin file)
 *   node scripts/odyssey-time-board-freeze.mjs --check   compare only; exit 1 on a difference
 *
 * WHAT AN ORB'S FINGERPRINT COVERS (four parts, pinned separately so a failure can say which moved):
 *
 *   level  The orb's whole assembled definition (data/levels.js LEVEL_CONFIGS: goal, failure,
 *          bonuses, stars, board and opening, speed, pieces, modifiers, tide, rival settings,
 *          victory lap, seed id, chapter...), minus the words and looks in PRESENTATION_ONLY.
 *          Everything else is in, so a new gameplay field is covered the day it is added.
 *   rules  What the engine turns that definition into before the first piece: the rule fields of
 *          the game state GameplayHybridEngine creates (RESOLVED_RULE_FIELDS) and the engine's own
 *          rubble, ramp and tide. This catches a shared default moving (lock delay, drop
 *          interval, spawn policy) and a modifier resolving differently.
 *   rival  Rival orbs only. Everything the real OdysseyBotMatch builds its bot from, read off the
 *          built match: the tier's resolved pace, search and weights with the orb's overrides, the
 *          planning rate, the duel's match rules and the rival seat's board rules.
 *   play   Rival orbs only. The rival's search is code, not data, so how it plays is pinned by
 *          playing it. The real match runs each of RIVAL_PLAY_SEEDS for RIVAL_PLAY_SECONDS of game
 *          time against a player who never touches the controls, then that player is knocked out
 *          and the match runs RIVAL_ROUND_CHANGE_SECONDS more, through the round change. Every
 *          piece the rival locks and every round change goes into the digest. The duel runs on
 *          its fixed 60 Hz clock with seeded dice, so the run is the same on every machine. A
 *          comment or a refactor leaves it alone; a change to how the rival plays, to the round
 *          change, or to the physics and scoring under both seats moves it.
 *
 * WHAT IT DOES NOT COVER: rules shared by every orb that are code. Core physics, scoring, gravity
 * and cascades are seen only through the eight rival orbs' `play`, as far as a minute of duel
 * reaches them; the 50 solo orbs have no played part. The generator of an orb's starting rubble,
 * the modifiers' own implementations, the victory evaluator and charms are not fingerprinted at
 * all. A change to those that alters clear times needs a new board generation for every orb it
 * reaches, and this gate will not ask for it.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isReleaseSteamAppId, RELEASE_STEAM_APP_ID } from '../electron/steam-app-id.js';
import { fillBag, spawnPiece } from '../src/core/game.js';
import { GameplayHybridEngine } from '../src/core/odyssey/GameplayHybridEngine.js';
import { OdysseyBotMatch } from '../src/core/odyssey/OdysseyBotMatch.js';
import { LEVEL_CONFIGS } from '../src/core/odyssey/data/levels.js';
import { hasOdysseyTimeBoard } from '../src/core/odyssey/odyssey-time-board.js';
import { odysseyTimeBoardName } from '../src/core/steam/steam-catalogue.js';

/** Repo-relative paths a failure message names. */
export const PIN_FILE = 'tests/fixtures/odyssey-time-board-pins.json';
export const GENERATIONS_FILE = 'src/core/steam/steam-catalogue.js';
export const APP_ID_FILE = 'electron/steam-app-id.js';
export const REPIN_COMMAND = 'node scripts/odyssey-time-board-freeze.mjs';

const PIN_FILE_URL = new URL(`../${PIN_FILE}`, import.meta.url);

/**
 * The only parts of an orb's definition left out of `level`: words and looks, which cannot change
 * how fast the orb is cleared. `*` stands for every element of a list. Keep this list short. When
 * in doubt leave a key in: the cost is one re-pin, and leaving a rule out costs a mixed board.
 */
export const PRESENTATION_ONLY = Object.freeze([
    'name',
    'theme',
    'pathPosition',
    'emotionalBeat',
    'metadata.description',
    'metadata.tip',
    'metadata.subtitle',
    'victory.primary.description',
    'victory.bonuses.*.description',
    'mechanics.versus.botName',
]);

/**
 * The rule fields of a freshly created game state that go into `rules`. A named list, not the
 * whole state: the state also carries counters, caches and a wall-clock start time, and a new
 * bookkeeping field must not move 58 pins. Add a field here when the engine gains a rule.
 */
export const RESOLVED_RULE_FIELDS = Object.freeze([
    'isInfinityMode', 'maxRows', 'initialInfinityRows', 'infinityVisibleRows', 'infinitySpawnOffsetRows',
    'infinitySpawnPolicy', 'cameraRow', 'cameraCenterRow',
    'level', 'linesUntilNextLevel', 'disableLevelProgression', 'dropInterval', 'speedMultiplier', 'simTickMs',
    'lockStyle', 'lockDelay', 'lockDelayTicks', 'lockResetLimit', 'lockBonusPolicy',
    'pieceRandomizer', 'finiteSupply', 'gravityWaits', 'useFixedCascade', 'hitStopEnabled',
    'disableGarbage', 'handicap', 'enableCascadingGravity', 'comboMultiplierEnabled',
]);

/** What the engine itself resolves beside the game state. */
const RESOLVED_ENGINE_FIELDS = Object.freeze(['rubbleStart', 'rampBaseInterval', 'tide']);

/**
 * A rival controller's fields that are its wiring or the state of a game in progress, not what it
 * was built from.
 */
const RIVAL_RUNTIME_STATE = new Set([
    'playerIndex', 'actions', 'currentSpawnToken', 'readyAtMs', 'lastPlan', 'machinePlan', 'planJob', 'pendingPlan',
    'planUnitCredit', 'planBoardKey', 'proof', 'queueAtPlan', 'refusals', 'life', 'paceDue',
    'activeSearch', 'nextSearchUnit', 'checkedDrop', 'dropHesitation',
    // Drawn from the orb's botJudgment by the match seed; the judgment itself is in `level`.
    'judgment',
]);

/** The seeded runs behind `play`. Three seeds, so a rival with two playing styles shows both. */
export const RIVAL_PLAY_SEEDS = Object.freeze([20261126, 15001, 1001]);
/** Game seconds of duel before the idle player is knocked out, and after. */
export const RIVAL_PLAY_SECONDS = 45;
export const RIVAL_ROUND_CHANGE_SECONDS = 10;
const DUEL_TICK_MS = 1000 / 60;

/**
 * @typedef {{ board: string, level: string, rules: string, rival?: string, play?: string }} OrbPin
 * @typedef {Record<string, OrbPin>} OrbPins
 * @typedef {{ orb: number, kind: 'changed'|'board'|'unpinned'|'stale', parts: string[], message: string }} PinProblem
 */

/** @param {unknown} value */
function isPlain(value) {
    if (value === null || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * A stable text for plain data: keys sorted, lists in order, nothing skipped silently. Anything
 * that is not plain data throws, so a function or a class instance can never hash as `{}`.
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string}
 */
export function canonical(value, path = '$') {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : `"${value}"`;
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item, index) => canonical(item, `${path}[${index}]`)).join(',')}]`;
    if (!isPlain(value)) throw new TypeError(`${path} is not plain data, so it cannot be fingerprinted`);
    const record = /** @type {Record<string, unknown>} */ (value);
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(record[key], `${path}.${key}`)}`).join(',')}}`;
}

/** @param {unknown} value */
function digest(value) {
    return createHash('sha256').update(canonical(value)).digest('hex').slice(0, 16);
}

/**
 * The data inside a live object: its functions and class instances dropped at any depth. For the
 * engine's and the match's own objects, which hold methods beside their numbers. An orb's
 * definition never goes through this: it must be plain data, and `canonical` insists.
 * @param {unknown} value
 * @returns {unknown}
 */
function dataOnly(value) {
    if (Array.isArray(value)) return value.map(dataOnly);
    if (isPlain(value)) {
        const record = /** @type {Record<string, unknown>} */ (value);
        return Object.fromEntries(Object.entries(record)
            .filter(([, item]) => typeof item !== 'function' && (item === null || typeof item !== 'object'
                || Array.isArray(item) || isPlain(item)))
            .map(([key, item]) => [key, dataOnly(item)]));
    }
    return value;
}

/** @param {any} node @param {string[]} keys */
function omitPath(node, keys) {
    if (node === null || typeof node !== 'object') return;
    const [key, ...rest] = keys;
    if (key === '*') {
        if (Array.isArray(node)) node.forEach((item) => omitPath(item, rest));
    } else if (rest.length === 0) {
        delete node[key];
    } else {
        omitPath(node[key], rest);
    }
}

/**
 * An orb's definition without its words and looks.
 * @param {Record<string, any>} level
 */
export function gameplayConfig(level) {
    const copy = structuredClone(level);
    for (const path of PRESENTATION_ONLY) omitPath(copy, path.split('.'));
    return copy;
}

// Calls may overlap (a run awaits while another starts), so the console comes back with the last.
let quietDepth = 0;
/** @type {Partial<Console>} */
let quietSaved = {};

/**
 * Run with the console quiet: the engine and the match announce themselves at every build.
 * @template T
 * @param {() => T} work
 * @returns {T}
 */
function quietly(work) {
    if (quietDepth++ === 0) {
        quietSaved = { log: console.log, debug: console.debug, warn: console.warn };
        console.log = () => {};
        console.debug = () => {};
        console.warn = () => {};
    }
    const restore = () => {
        if (--quietDepth === 0) Object.assign(console, quietSaved);
    };
    let result;
    try {
        result = work();
    } catch (error) {
        restore();
        throw error;
    }
    if (result instanceof Promise) return /** @type {any} */ (result.finally(restore));
    restore();
    return result;
}

/**
 * The session the game builds for an orb, as far as its rules go.
 * @param {Record<string, any>} level
 */
function createSession(level) {
    const hybridEngine = new GameplayHybridEngine();
    hybridEngine.configure(level);
    return { levelConfig: level, hybridEngine, gameState: hybridEngine.createGameState() };
}

/**
 * What the engine resolves an orb to before the first piece.
 * @param {Record<string, any>} level
 */
export function resolvedRules(level) {
    return quietly(() => {
        const { hybridEngine, gameState } = createSession(level);
        const engine = /** @type {Record<string, any>} */ (hybridEngine);
        const state = /** @type {Record<string, any>} */ (gameState);
        return {
            engine: dataOnly(Object.fromEntries(RESOLVED_ENGINE_FIELDS.map((key) => [key, engine[key]]))),
            state: Object.fromEntries(RESOLVED_RULE_FIELDS.map((key) => [key, state[key]])),
        };
    });
}

/**
 * Everything the real match builds an orb's rival from, or null for an orb without one.
 * @param {Record<string, any>} level
 */
export function rivalSetup(level) {
    if (!level?.mechanics?.versus) return null;
    return quietly(() => {
        const match = new OdysseyBotMatch(createSession(level), { seed: RIVAL_PLAY_SEEDS[0], isActive: () => false });
        try {
            const bot = /** @type {Record<string, any>} */ (match.bot);
            const seat = /** @type {Record<string, any>} */ (match.players[1]);
            // Every piece of data the controller holds is something it was built from, apart from
            // the wiring and game-in-progress fields above. A new tuning field is covered the day
            // it is added.
            const built = dataOnly(Object.fromEntries(Object.entries(bot)
                .filter(([key]) => !RIVAL_RUNTIME_STATE.has(key))));
            return {
                controller: bot.constructor.name,
                built,
                targetFrags: match.targetFrags,
                matchRules: dataOnly(match.multiplayer.matchConfig),
                seat: Object.fromEntries(['level', 'dropInterval', 'useFixedCascade', 'disableGarbage',
                    'disableLevelProgression', 'suppressExternalInput'].map((key) => [key, seat[key]])),
            };
        } finally {
            match.stop();
        }
    });
}

/**
 * One seeded duel against a player who never touches the controls, knocked out once near the end.
 * Returns what the rival did and when the rounds changed.
 * @param {Record<string, any>} level
 * @param {number} seed
 */
function playRival(level, seed) {
    return quietly(async () => {
        const session = createSession(level);
        const match = new OdysseyBotMatch(session, { seed, isActive: () => true });
        const human = /** @type {Record<string, any>} */ (session.gameState);
        fillBag(human.nextPieces, human.randomGenerator, human.pieceRandomizer);
        spawnPiece(human);
        match.prepareBot();
        // The idle player's pieces still fall, lock and come again, as they would in the game.
        const humanCallbacks = match.wrapHumanCallbacks({});
        const rival = /** @type {Record<string, any>} */ (match.players[1]);
        /** @type {number[][]} */
        const locks = [];
        /** @type {number[][]} */
        const rounds = [];
        let placed = rival.piecesPlaced;
        let round = match.round;
        const knockOutAt = RIVAL_PLAY_SECONDS * 60;
        const ticks = knockOutAt + RIVAL_ROUND_CHANGE_SECONDS * 60;
        let tick = 0;
        try {
            for (; tick < ticks && !match.multiplayer.isGameOver; tick++) {
                // The call the game makes when the player's spawn is blocked.
                if (tick === knockOutAt) match.markTopOut(0);
                match.update(tick * DUEL_TICK_MS, DUEL_TICK_MS, humanCallbacks);
                // A knock-out ends the round behind a promise; the next tick must see it settled.
                if (match.transition) await match.transition;
                const failure = /** @type {any} */ (match).error;
                if (failure) throw failure;
                if (match.round !== round) {
                    round = match.round;
                    placed = rival.piecesPlaced;
                    rounds.push([tick, round, ...match.multiplayer.frags]);
                }
                if (rival.piecesPlaced !== placed) {
                    placed = rival.piecesPlaced;
                    locks.push([tick, round, placed, rival.score, rival.lines,
                        match.multiplayer.garbageQueues[0].getTotalLines()]);
                }
            }
            return {
                seed, endedAtTick: tick, frags: [...match.multiplayer.frags], rounds, locks,
            };
        } finally {
            match.stop();
        }
    });
}

/**
 * How an orb's rival plays, as seeded runs of the real match; null for an orb without one.
 * @param {Record<string, any>} level
 */
export async function rivalPlay(level) {
    if (!level?.mechanics?.versus) return null;
    const runs = [];
    for (const seed of RIVAL_PLAY_SEEDS) runs.push(await playRival(level, seed));
    return runs;
}

/**
 * An orb's fingerprint, in its parts.
 * @param {Record<string, any>} level
 * @returns {Promise<Omit<OrbPin, 'board'>>}
 */
export async function fingerprintOrb(level) {
    /** @type {Omit<OrbPin, 'board'>} */
    const parts = { level: digest(gameplayConfig(level)), rules: digest(resolvedRules(level)) };
    const setup = rivalSetup(level);
    if (setup) {
        parts.rival = digest(setup);
        parts.play = digest(await rivalPlay(level));
    }
    return parts;
}

/**
 * Board name and fingerprint of every orb that has a time board, by orb id.
 * @param {{ levels?: ReadonlyArray<Record<string, any>>, boardName?: (orb: number) => string }} [options]
 * @returns {Promise<OrbPins>}
 */
export async function currentPins({ levels = LEVEL_CONFIGS, boardName = odysseyTimeBoardName } = {}) {
    /** @type {OrbPins} */
    const pins = {};
    for (const level of [...levels].sort((a, b) => a.id - b.id)) {
        if (!hasOdysseyTimeBoard(level)) continue;
        pins[level.id] = { board: boardName(level.id), ...await fingerprintOrb(level) };
    }
    return pins;
}

const PART_NAMES = Object.freeze({
    level: 'its definition',
    rules: 'the rules the engine resolves it to',
    rival: 'what its rival is built from',
    play: 'how its rival plays',
});

/**
 * Compare today's orbs with the pinned ones. Empty when nothing moved.
 *
 * Until the game has its Steam App ID no board is public, so nothing can be mixed yet and a
 * changed orb only needs its pin renewed. From the day the App ID is set, a changed orb is asked
 * for a board of its own.
 * @param {OrbPins} current
 * @param {OrbPins} pinned
 * @param {{ boardsArePublic?: boolean }} [options]
 * @returns {PinProblem[]}
 */
export function comparePins(current, pinned, { boardsArePublic = isReleaseSteamAppId(RELEASE_STEAM_APP_ID) } = {}) {
    /** @type {PinProblem[]} */
    const problems = [];
    const orbs = [...new Set([...Object.keys(current), ...Object.keys(pinned)])].map(Number).sort((a, b) => a - b);
    for (const orb of orbs) {
        const now = current[orb];
        const then = pinned[orb];
        if (!then) {
            problems.push({
                orb,
                kind: 'unpinned',
                parts: [],
                message: `Orb ${orb} has a time board (${now.board}) and no pin. Re-pin with \`${REPIN_COMMAND}\`.`,
            });
        } else if (!now) {
            problems.push({
                orb,
                kind: 'stale',
                parts: [],
                message: `Orb ${orb} is pinned on ${then.board} and has no time board any more. `
                    + `Re-pin with \`${REPIN_COMMAND}\`.`,
            });
        } else if (now.board !== then.board) {
            problems.push({
                orb,
                kind: 'board',
                parts: [],
                message: `Orb ${orb} races on a new board, ${now.board} (pinned: ${then.board}). Add ${now.board} on the `
                    + `Steam partner site if it is not there yet, then re-pin with \`${REPIN_COMMAND}\`.`,
            });
        } else {
            const parts = /** @type {Array<keyof typeof PART_NAMES>} */ (Object.keys(PART_NAMES))
                .filter((part) => now[part] !== then[part]);
            if (!parts.length) continue;
            const what = `Orb ${orb} changed (${parts.map((part) => PART_NAMES[part]).join('; ')}) and still races on ${now.board}.`;
            problems.push({
                orb,
                kind: 'changed',
                parts,
                message: boardsArePublic
                    ? `${what} If the change can alter its clear time, give orb ${orb} a new board generation in `
                        + `${GENERATIONS_FILE} (ODYSSEY_TIME_BOARD_GENERATIONS), add that board on the Steam partner `
                        + `site, then re-pin with \`${REPIN_COMMAND}\`. If it cannot, re-pin only.`
                    : `${what} The game has no Steam App ID yet (${APP_ID_FILE}), so no board is public and no times `
                        + `can be mixed: re-pin with \`${REPIN_COMMAND}\` and leave the board generations alone. Once `
                        + 'the App ID is set, a change that can alter a clear time needs a new board for that orb.',
            });
        }
    }
    return problems;
}

/** @returns {OrbPins} */
export function readPins() {
    return JSON.parse(readFileSync(PIN_FILE_URL, 'utf8')).orbs;
}

/**
 * The pin file's text: one orb to a line, so two branches that each move a different orb merge.
 * @param {OrbPins} pins
 */
export function serializePins(pins) {
    const lines = Object.keys(pins).map(Number).sort((a, b) => a - b)
        .map((orb) => `    ${JSON.stringify(String(orb))}: ${JSON.stringify(pins[orb])}`);
    const about = `Odyssey orb time boards, pinned. Do not edit by hand: run \`${REPIN_COMMAND}\`. `
        + 'What the parts mean is at the top of that script; when an orb needs a new board is at '
        + `ODYSSEY_TIME_BOARD_GENERATIONS in ${GENERATIONS_FILE}.`;
    return `{\n  "about": ${JSON.stringify(about)},\n  "orbs": {\n${lines.join(',\n')}\n  }\n}\n`;
}

async function main() {
    const checkOnly = process.argv.includes('--check');
    const current = await currentPins();
    /** @type {OrbPins} */
    let pinned = {};
    try {
        pinned = readPins();
    } catch {
        if (checkOnly) throw new Error(`${PIN_FILE} is missing or unreadable. Pin with \`${REPIN_COMMAND}\`.`);
    }
    const problems = comparePins(current, pinned);
    const count = Object.keys(current).length;
    if (checkOnly) {
        for (const problem of problems) console.error(problem.message);
        console.log(problems.length
            ? `${problems.length} orb(s) differ from ${PIN_FILE}.`
            : `All ${count} orb time boards match their pins.`);
        process.exitCode = problems.length ? 1 : 0;
        return;
    }
    writeFileSync(PIN_FILE_URL, serializePins(current));
    console.log(`Pinned ${count} orb time boards to ${PIN_FILE}.`);
    if (problems.length === count && problems.every((problem) => problem.kind === 'unpinned')) {
        console.log('First pin: nothing to compare with.');
    } else if (problems.length) {
        console.log(`Moved since the last pin:\n${problems.map((problem) => `  orb ${problem.orb}: ${problem.kind}`
            + `${problem.parts.length ? ` (${problem.parts.join(', ')})` : ''}`).join('\n')}`);
    } else {
        console.log('Nothing had moved.');
    }
}

// Run as a script, not imported by the test. Windows spells a drive letter either way.
const invoked = process.argv[1] ? resolve(process.argv[1]).toLowerCase() : '';
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) await main();

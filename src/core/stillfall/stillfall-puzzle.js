// @ts-check

/**
 * Stillfall puzzle definitions: an authored structure, a short visible supply of
 * pieces, and one declarative goal. Gravity waits for the player, so every reachable
 * landing is open to them; the cascade rule (each body falls as one rigid unit, and
 * different bodies never glue) is the solving tool.
 *
 * A definition is plain data, so a puzzle bank can live in JSON:
 *
 *   {
 *     id: 'fl-first-fall', title: 'First fall', lesson: '…',
 *     rows: ['..AA......', 'BBBBBBBB.B'],   // bottom-aligned, '.' is empty
 *     supply: ['I'],                          // dealt in order, nothing refills it
 *     goal: { type: 'waves', atLeast: 2 },
 *   }
 *
 * Each letter in `rows` is one body. A body must be one 4-connected group; two bodies
 * may touch, and stay separate bodies.
 */

import {
    COLS, ROWS, HIDDEN_ROWS, PIECE_KEYS, COLORS,
} from '../constants.js';

export const STILLFALL_BOARD_HEIGHT = ROWS + HIDDEN_ROWS;

/** The tallest structure that still leaves the spawn area and room to steer. */
export const MAX_STRUCTURE_ROWS = ROWS - 6;

/** Five is the most the certifier can prove exhaustively on every CI run (seconds a puzzle). */
export const MAX_SUPPLY = 5;

/**
 * - waves: one lock sets off a cascade of at least `atLeast` waves
 * - lines: at least `atLeast` lines cleared over the whole puzzle
 * - clear-all: the well ends empty
 * - relic-floor: some cell of body `body` comes to rest on the floor
 * - seal: every cell of body `body` is cleared away
 * - all: two or three of the goals above hold after the same lock (`of`)
 */
export const GOAL_TYPES = Object.freeze(['waves', 'lines', 'clear-all', 'relic-floor', 'seal', 'all']);

/** The most goals one puzzle asks for at once. */
export const MAX_GOAL_PARTS = 3;

/**
 * @typedef {Object} StillfallGoal
 * @property {'waves'|'lines'|'clear-all'|'relic-floor'|'seal'|'all'} type
 * @property {number} [atLeast]
 * @property {string} [body] relic-floor and seal: the body letter in `rows`
 * @property {StillfallGoal[]} [of] all: the goals that must hold together
 */

/**
 * The single goals a goal is made of: its parts for `all`, else itself.
 * @param {StillfallGoal} goal
 * @returns {StillfallGoal[]}
 */
export function goalParts(goal) {
    return goal.type === 'all' ? /** @type {StillfallGoal[]} */ (goal.of) : [goal];
}

/**
 * The body letters a goal marks on the board, by kind.
 * @param {StillfallGoal} goal
 * @returns {{ relics: string[], seals: string[] }}
 */
export function markedBodies(goal) {
    const parts = goalParts(goal);
    const bodiesOf = (/** @type {string} */ type) => parts
        .filter((part) => part.type === type)
        .map((part) => /** @type {string} */ (part.body));
    return { relics: bodiesOf('relic-floor'), seals: bodiesOf('seal') };
}

/**
 * @typedef {Object} SolutionStep
 * @property {string} piece the supply piece this step places
 * @property {number} rotation right rotations from the dealt orientation, 0–3
 * @property {number} x the column of the shape matrix's origin, as the solver reports it
 */

/**
 * @typedef {Object} StillfallDefinition
 * @property {string} id
 * @property {string} title
 * @property {string} [lesson]
 * @property {string[]} rows
 * @property {string[]} supply
 * @property {StillfallGoal} goal
 * @property {SolutionStep[]} [solution] one straight-drop solution, for hints; CI checks it
 */

/**
 * @typedef {Object} LockedBody
 * @property {number} x
 * @property {number} y
 * @property {number[][]} shape
 * @property {number} pieceId
 * @property {string} shapeKey
 * @property {string} type
 * @property {string} color
 * @property {string} [body] the authored letter
 */

/**
 * @typedef {Object} StillfallPuzzle
 * @property {string} id
 * @property {string} title
 * @property {string} lesson
 * @property {string[]} supply
 * @property {StillfallGoal} goal
 * @property {SolutionStep[]} solution
 * @property {LockedBody[]} lockedPieces
 * @property {Record<string, number>} bodyIds authored letter → pieceId
 * @property {number} nextPieceId first id free for dealt pieces
 * @property {number} boardHeight
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * Checks a definition and returns every problem found; an empty list means it is valid.
 * @param {unknown} definition
 * @returns {string[]}
 */
export function validatePuzzleDefinition(definition) {
    const problems = [];
    const def = /** @type {Partial<StillfallDefinition>} */ (definition || {});
    if (typeof def.id !== 'string' || !ID_PATTERN.test(def.id)) problems.push('id must be a short kebab-case string');
    if (typeof def.title !== 'string' || !def.title.trim()) problems.push('title is required');

    const rows = Array.isArray(def.rows) ? def.rows : null;
    if (!rows || rows.length === 0) {
        problems.push('rows must be a non-empty list');
    } else {
        if (rows.length > MAX_STRUCTURE_ROWS) problems.push(`at most ${MAX_STRUCTURE_ROWS} rows`);
        rows.forEach((row, index) => {
            if (typeof row !== 'string' || row.length !== COLS) {
                problems.push(`row ${index} must be ${COLS} characters`);
            } else if (!/^[.A-Za-z]+$/.test(row)) {
                problems.push(`row ${index} may only hold '.' and letters`);
            } else if (!row.includes('.')) {
                problems.push(`row ${index} is already full`);
            }
        });
        if (problems.length === 0) {
            for (const [letter, cells] of bodyCells(rows)) {
                if (!isConnected(cells)) problems.push(`body '${letter}' must be one connected group`);
            }
        }
    }

    const supply = Array.isArray(def.supply) ? def.supply : null;
    if (!supply || supply.length === 0 || supply.length > MAX_SUPPLY) {
        problems.push(`supply must hold 1–${MAX_SUPPLY} pieces`);
    } else {
        supply.forEach((key) => {
            if (typeof key !== 'string' || key.length !== 1 || !PIECE_KEYS.includes(key)) {
                problems.push(`unknown supply piece '${key}'`);
            }
        });
    }

    if (def.solution !== undefined) {
        const steps = Array.isArray(def.solution) ? def.solution : null;
        if (!steps || (supply && steps.length !== supply.length)) {
            problems.push('solution must list one step per supply piece');
        } else {
            steps.forEach((step, index) => {
                if (!step || step.piece !== supply?.[index] || !Number.isInteger(step.rotation)
                    || step.rotation < 0 || step.rotation > 3 || !Number.isInteger(step.x)) {
                    problems.push(`solution step ${index} must name supply piece ${index}, a rotation 0–3 and a column`);
                }
            });
        }
    }

    const { goal } = def;
    if (!goal || !GOAL_TYPES.includes(goal.type)) {
        problems.push(`goal.type must be one of ${GOAL_TYPES.join(', ')}`);
    } else if (goal.type === 'all') {
        const parts = Array.isArray(goal.of) ? goal.of : [];
        if (parts.length < 2 || parts.length > MAX_GOAL_PARTS) {
            problems.push(`goal.of must hold 2–${MAX_GOAL_PARTS} goals`);
        } else {
            parts.forEach((part, index) => {
                if (!part || part.type === 'all' || !GOAL_TYPES.includes(part.type)) {
                    problems.push(`goal.of[${index}] must be a single goal`);
                } else {
                    problems.push(...singleGoalProblems(part, rows).map((problem) => `goal.of[${index}]: ${problem}`));
                }
            });
            const types = parts.map((part) => part?.type);
            if (types.includes('clear-all') && types.some((type) => type === 'relic-floor' || type === 'seal')) {
                problems.push('an empty well cannot go with a relic (it would be cleared) or a seal (it would be gone anyway)');
            }
            const bodies = parts.map((part) => part?.body).filter(Boolean);
            if (new Set(bodies).size !== bodies.length) problems.push('each marked body may serve one goal');
            if (new Set(types).size !== types.length && !types.every((type) => type === 'relic-floor' || type === 'seal')) {
                problems.push('only relics and seals may repeat');
            }
        }
    } else {
        problems.push(...singleGoalProblems(goal, rows));
    }
    return problems;
}

/**
 * @param {StillfallGoal} goal a goal other than `all`
 * @param {string[] | null} rows
 * @returns {string[]}
 */
function singleGoalProblems(goal, rows) {
    if (goal.type === 'waves' || goal.type === 'lines') {
        if (!Number.isInteger(goal.atLeast) || /** @type {number} */ (goal.atLeast) < 1) {
            return ['goal.atLeast must be a positive whole number'];
        }
    } else if (goal.type === 'relic-floor' || goal.type === 'seal') {
        const letter = goal.body;
        if (typeof letter !== 'string' || letter.length !== 1 || !rows?.some((row) => row.includes(letter))) {
            return ['goal.body must name a body in rows'];
        }
        if (goal.type === 'relic-floor' && rows && rows[rows.length - 1].includes(letter)) {
            return ['the relic must not start on the floor'];
        }
    }
    return [];
}

/**
 * Builds a playable puzzle from a valid definition.
 * @param {StillfallDefinition} definition
 * @returns {StillfallPuzzle}
 */
export function buildPuzzle(definition) {
    const problems = validatePuzzleDefinition(definition);
    if (problems.length > 0) {
        throw new Error(`[Stillfall] Invalid puzzle '${definition?.id}': ${problems.join('; ')}`);
    }
    const top = STILLFALL_BOARD_HEIGHT - definition.rows.length;
    const bodies = bodyCells(definition.rows);
    const types = bodyTypes(definition.rows, [...bodies.keys()]);
    /** @type {LockedBody[]} */
    const lockedPieces = [];
    /** @type {Record<string, number>} */
    const bodyIds = {};
    let pieceId = 0;
    for (const [letter, cells] of bodies) {
        pieceId += 1;
        bodyIds[letter] = pieceId;
        const minX = Math.min(...cells.map(([x]) => x));
        const maxX = Math.max(...cells.map(([x]) => x));
        const minY = Math.min(...cells.map(([, y]) => y));
        const maxY = Math.max(...cells.map(([, y]) => y));
        const shape = Array.from({ length: maxY - minY + 1 }, () => Array(maxX - minX + 1).fill(0));
        cells.forEach(([x, y]) => { shape[y - minY][x - minX] = 1; });
        const type = /** @type {string} */ (types.get(letter));
        lockedPieces.push({
            x: minX,
            y: top + minY,
            shape,
            pieceId,
            shapeKey: type,
            type,
            color: COLORS[type],
            body: letter,
        });
    }
    return {
        id: definition.id,
        title: definition.title,
        lesson: definition.lesson || '',
        supply: definition.supply.slice(),
        goal: { ...definition.goal },
        solution: (definition.solution || []).map((step) => ({ ...step })),
        lockedPieces,
        bodyIds,
        nextPieceId: pieceId + 1,
        boardHeight: STILLFALL_BOARD_HEIGHT,
    };
}

/**
 * Cells of each body in first-appearance order (top row first, left to right).
 * @param {string[]} rows
 * @returns {Map<string, Array<[number, number]>>} letter → [x, rowIndex]
 */
function bodyCells(rows) {
    /** @type {Map<string, Array<[number, number]>>} */
    const bodies = new Map();
    rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x += 1) {
            const letter = row[x];
            if (letter === '.') continue;
            if (!bodies.has(letter)) bodies.set(letter, []);
            /** @type {Array<[number, number]>} */ (bodies.get(letter)).push([x, y]);
        }
    });
    return bodies;
}

/**
 * A piece colour for each body, never one a touching body has: the board draws
 * same-coloured neighbours as one fused shape, which would hide where one body ends.
 * @param {string[]} rows
 * @param {string[]} letters in first-appearance order
 * @returns {Map<string, string>}
 */
function bodyTypes(rows, letters) {
    /** @type {Map<string, Set<string>>} */
    const touching = new Map(letters.map((letter) => [letter, new Set()]));
    rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x += 1) {
            const here = row[x];
            if (here === '.') continue;
            for (const other of [row[x + 1], rows[y + 1]?.[x]]) {
                if (other && other !== '.' && other !== here) {
                    /** @type {Set<string>} */ (touching.get(here)).add(other);
                    /** @type {Set<string>} */ (touching.get(other)).add(here);
                }
            }
        }
    });
    /** @type {Map<string, string>} */
    const types = new Map();
    letters.forEach((letter, index) => {
        const neighbours = /** @type {Set<string>} */ (touching.get(letter));
        const taken = new Set([...neighbours].map((other) => types.get(other)));
        // Start each body at a different colour so separate bodies vary too.
        const choices = Array.from(
            { length: PIECE_KEYS.length },
            (_, k) => PIECE_KEYS[(index + k) % PIECE_KEYS.length],
        );
        types.set(letter, choices.find((type) => !taken.has(type)) || choices[0]);
    });
    return types;
}

/** @param {Array<[number, number]>} cells */
function isConnected(cells) {
    const keys = new Set(cells.map(([x, y]) => `${x},${y}`));
    const seen = new Set([`${cells[0][0]},${cells[0][1]}`]);
    const queue = [cells[0]];
    while (queue.length > 0) {
        const [x, y] = /** @type {[number, number]} */ (queue.shift());
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const key = `${x + dx},${y + dy}`;
            if (keys.has(key) && !seen.has(key)) {
                seen.add(key);
                queue.push([x + dx, y + dy]);
            }
        }
    }
    return seen.size === keys.size;
}

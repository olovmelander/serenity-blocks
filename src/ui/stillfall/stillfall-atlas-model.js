/**
 * @fileoverview The Stillfall puzzle atlas as data (pure, no DOM): the tiers in the order the
 * descent goes, each puzzle with its state and its starting structure, the counts the header
 * shows, why a tier is still shut, and where a key or a pad step lands. stillfall-atlas.js
 * draws it; tests/unit/stillfall-atlas-model.test.js checks it against the real bank.
 *
 * A state is what StillfallMode publishes (EVENTS.STILLFALL_STATE): `bank` lists every
 * puzzle with `open` and `solved`, `puzzle.id` is the one on the board. The structure, the
 * supply, the goal and the lesson come from the bank's own definitions.
 */
import { SOLVES_TO_OPEN_NEXT_TIER, STILLFALL_PUZZLES, TIERS } from '../../core/stillfall/puzzle-bank.js';
import { goalParts } from '../../core/stillfall/stillfall-puzzle.js';
import { capitalised, countWord } from './stillfall-copy.js';

/** Columns of the well, and the tallest structure the bank holds (previews share this frame). */
export const PREVIEW_COLUMNS = 10;
export const PREVIEW_ROWS = Math.max(...STILLFALL_PUZZLES.map((puzzle) => puzzle.rows.length));
/** Body shades a preview alternates so that touching bodies never share one. */
const SHADES = 4;

/** What each tier brings, in the bank's own terms (puzzle-bank.js). */
export const TIER_LEDES = Object.freeze({
    1: 'One piece each, and each puzzle teaches one idea.',
    2: 'Two pieces now, and the relic: bring it to the floor.',
    3: 'Two pieces, and cascades three and four waves deep.',
    4: 'Three pieces, and every one of them matters.',
    5: 'Three pieces. Only one first landing leads anywhere.',
    6: 'Three pieces for the longest cascades: five and six waves.',
    7: 'The seal: a body to clear away entirely.',
    8: 'Two goals at once, met by the same piece.',
    9: 'A fourth piece in the supply.',
    10: 'Four pieces, and two goals at once.',
});

const definitions = new Map(STILLFALL_PUZZLES.map((puzzle) => [puzzle.id, puzzle]));

/** "One piece each", "Three pieces each", "Three or four pieces". */
export function piecesText(counts) {
    const sizes = [...new Set(counts)].sort((a, b) => a - b);
    if (sizes.length === 0) return '';
    if (sizes.length === 1) return `${capitalised(countWord(sizes[0]))} ${sizes[0] === 1 ? 'piece' : 'pieces'} each`;
    return `${capitalised(countWord(sizes[0]))} to ${countWord(sizes.at(-1))} pieces`;
}

/**
 * A shade for every body that none of the bodies it touches has. The bodies of a well form a
 * planar map, so four shades always do; a short search finds them where a greedy pass would
 * not. Each body starts from a different shade, so separate bodies vary too.
 * @param {string[]} order the bodies, in first-appearance order
 * @param {Map<string, Set<string>>} touching
 * @returns {Map<string, number>}
 */
function shadeBodies(order, touching) {
    const shades = new Map();
    let budget = 20000;
    const assign = (index) => {
        if (index === order.length) return true;
        budget -= 1;
        if (budget < 0) return false;
        const letter = order[index];
        const taken = new Set([...touching.get(letter)].map((other) => shades.get(other)));
        for (let k = 0; k < SHADES; k += 1) {
            const shade = (index + k) % SHADES;
            if (taken.has(shade)) continue;
            shades.set(letter, shade);
            if (assign(index + 1)) return true;
            shades.delete(letter);
        }
        return false;
    };
    if (!assign(0)) order.forEach((letter, index) => { if (!shades.has(letter)) shades.set(letter, index % SHADES); });
    return shades;
}

/**
 * A puzzle's starting structure as preview cells, bottom-aligned in a frame every preview
 * shares: rows of `null` (empty) or { body, shade, relic, seal, seamRight, seamBelow }.
 * A seam marks the edge between two different bodies, so each body reads as one shape.
 * @param {{ rows: string[], goal: object }} definition
 * @param {number} [frameRows]
 */
export function previewCells(definition, frameRows = PREVIEW_ROWS) {
    const rows = definition?.rows || [];
    const parts = definition?.goal ? goalParts(definition.goal) : [];
    const relics = new Set(parts.filter((part) => part.type === 'relic-floor').map((part) => part.body));
    const seals = new Set(parts.filter((part) => part.type === 'seal').map((part) => part.body));
    const at = (x, y) => {
        const letter = rows[y]?.[x];
        return letter && letter !== '.' ? letter : null;
    };
    // Touching bodies, then a shade per body that none of its neighbours has.
    const touching = new Map();
    const order = [];
    rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x += 1) {
            const here = at(x, y);
            if (!here) continue;
            if (!touching.has(here)) {
                touching.set(here, new Set());
                order.push(here);
            }
            [at(x + 1, y), at(x, y + 1)].forEach((other) => {
                if (!other || other === here) return;
                if (!touching.has(other)) {
                    touching.set(other, new Set());
                    order.push(other);
                }
                touching.get(here).add(other);
                touching.get(other).add(here);
            });
        }
    });
    const shades = shadeBodies(order, touching);
    const pad = Math.max(0, frameRows - rows.length);
    return Array.from({ length: Math.max(frameRows, rows.length) }, (_, frameY) => {
        const y = frameY - pad;
        return Array.from({ length: PREVIEW_COLUMNS }, (__, x) => {
            const body = y >= 0 ? at(x, y) : null;
            if (!body) return null;
            const right = at(x + 1, y);
            const below = at(x, y + 1);
            return {
                body,
                shade: shades.get(body),
                relic: relics.has(body),
                seal: seals.has(body),
                seamRight: Boolean(right && right !== body),
                seamBelow: Boolean(below && below !== body),
            };
        });
    });
}

/**
 * Why a shut tier is shut, from the tier above it.
 * @returns {{ below: string, need: number, direct: boolean } | null}
 */
function lockOf(tier, above) {
    if (tier.open || !above) return null;
    return {
        below: above.name,
        need: Math.max(0, SOLVES_TO_OPEN_NEXT_TIER - above.solved),
        direct: above.open,
    };
}

/** "Solve 2 more in Undertow to open", or "Opens after Rift" when Rift is shut too. */
export function tierLockNote(tier) {
    const { lock } = tier;
    if (!lock) return '';
    if (!lock.direct) return `Opens after ${lock.below}`;
    return `Solve ${lock.need}${lock.need < SOLVES_TO_OPEN_NEXT_TIER ? ' more' : ''} in ${lock.below} to open`;
}

/** The note on the stage for an open tier: what it still takes to open the one after it. */
export function tierNextNote(tier, next) {
    if (!tier.open) return '';
    if (tier.solved === tier.puzzles.length) return 'All solved';
    if (!next || next.open) return '';
    const need = Math.max(0, SOLVES_TO_OPEN_NEXT_TIER - tier.solved);
    return `Solve ${need}${need < SOLVES_TO_OPEN_NEXT_TIER ? ' more' : ''} to open ${next.name}`;
}

/** Why a shut puzzle is shut, as one sentence. */
export function puzzleLockNote(model, puzzle) {
    const tier = model.tiers.find((entry) => entry.tier === puzzle.tier);
    if (!tier?.lock) return '';
    if (!tier.lock.direct) return `${tier.name} opens after ${tier.lock.below}.`;
    const more = tier.lock.need < SOLVES_TO_OPEN_NEXT_TIER ? ' more' : '';
    return `Solve ${tier.lock.need}${more} in ${tier.lock.below} to open ${tier.name}.`;
}

/**
 * @param {{ bank: Array<{id: string, title: string, tier: number, open: boolean, solved: boolean}>,
 *   puzzle?: { id: string } }} state
 */
export function buildAtlasModel(state) {
    const bank = state?.bank || [];
    const currentId = state?.puzzle?.id ?? null;
    const puzzles = new Map();
    const order = [];
    const tiers = [];
    TIERS.forEach(({ tier, name }) => {
        const entries = bank.filter((entry) => entry.tier === tier);
        if (entries.length === 0) return;
        const list = entries.map((entry, index) => {
            const definition = definitions.get(entry.id);
            let status = 'locked';
            if (entry.solved) status = 'solved';
            else if (entry.open) status = 'open';
            const puzzle = {
                id: entry.id,
                title: entry.title,
                tier,
                number: index + 1,
                open: Boolean(entry.open),
                solved: Boolean(entry.solved),
                current: entry.id === currentId,
                status,
                lesson: definition?.lesson || '',
                goal: definition?.goal || null,
                supply: definition?.supply?.slice() || [],
                definition: definition || null,
            };
            puzzles.set(puzzle.id, puzzle);
            order.push(puzzle);
            return puzzle;
        });
        const solved = list.filter((puzzle) => puzzle.solved).length;
        const open = list.some((puzzle) => puzzle.open);
        let status = 'locked';
        if (open) status = solved === list.length ? 'complete' : 'open';
        tiers.push({
            tier,
            name,
            number: tiers.length + 1,
            lede: TIER_LEDES[tier] || '',
            pieces: piecesText(list.map((puzzle) => puzzle.supply.length).filter(Boolean)),
            puzzles: list,
            solved,
            open,
            current: list.some((puzzle) => puzzle.current),
            status,
            lock: null,
        });
    });
    tiers.forEach((tier, index) => { tier.lock = lockOf(tier, tiers[index - 1]); });
    return {
        tiers,
        puzzles,
        order,
        currentId,
        solved: order.filter((puzzle) => puzzle.solved).length,
        total: order.length,
        tiersOpen: tiers.filter((tier) => tier.open).length,
    };
}

export function tierOf(model, tierNumber) {
    return model.tiers.find((tier) => tier.tier === tierNumber) || null;
}

/** The puzzle a tier opens on: the one on the board, else the first open one not yet solved. */
export function preferredPuzzle(tier) {
    if (!tier) return null;
    return tier.puzzles.find((puzzle) => puzzle.current)
        || tier.puzzles.find((puzzle) => puzzle.open && !puzzle.solved)
        || tier.puzzles.find((puzzle) => puzzle.open)
        || tier.puzzles[0]
        || null;
}

/** The puzzle beside this one (left, right), across the seams between tiers. */
export function stepPuzzle(model, id, step) {
    const index = model.order.findIndex((puzzle) => puzzle.id === id);
    if (index < 0) return null;
    return model.order[index + step] || null;
}

/**
 * The puzzle a row up or down in a grid of `columns`: the same column, or the last card of a
 * shorter last row; past the first or last row it goes on into the tier above or below.
 */
export function stepRow(model, id, step, columns) {
    const puzzle = model.puzzles.get(id);
    if (!puzzle) return null;
    const cols = Math.max(1, Math.floor(columns) || 1);
    const index = model.tiers.findIndex((tier) => tier.tier === puzzle.tier);
    const list = model.tiers[index].puzzles;
    const at = puzzle.number - 1;
    const column = at % cols;
    const target = at + step * cols;
    if (target >= 0 && target < list.length) return list[target];
    // A shorter last row: down from the row above it lands on its last card.
    if (step > 0 && Math.floor(at / cols) < Math.floor((list.length - 1) / cols)) return list.at(-1);
    const beside = model.tiers[index + Math.sign(step)];
    if (!beside) return null;
    const rows = Math.ceil(beside.puzzles.length / cols);
    const row = step > 0 ? 0 : rows - 1;
    return beside.puzzles[Math.min(beside.puzzles.length - 1, row * cols + column)] || null;
}

/** The tier above (-1) or below (1) this one. */
export function stepTier(model, tierNumber, step) {
    const index = model.tiers.findIndex((tier) => tier.tier === tierNumber);
    if (index < 0) return null;
    return model.tiers[index + step] || null;
}

/** Balanced rows: fourteen cards that fit eight to a row lay out as seven and seven. */
export function balancedColumns(count, fit) {
    if (count <= 0) return 1;
    const most = Math.max(1, Math.floor(fit) || 1);
    return Math.max(1, Math.ceil(count / Math.ceil(count / most)));
}

/**
 * What a key does in the atlas. `on` is what has focus: a puzzle card, a tier tab, or
 * anything else (a button, the page).
 * @returns {null | { close?: true, play?: true, hold?: true, across?: number, row?: number,
 *   tier?: number, focus?: 'tab'|'card', edge?: 'first'|'last' }}
 */
export function resolveAtlasKey(key, on = 'other') {
    if (key === 'Escape') return { close: true };
    if (key === 'PageUp') return { tier: -1, focus: on === 'tab' ? 'tab' : 'card' };
    if (key === 'PageDown') return { tier: 1, focus: on === 'tab' ? 'tab' : 'card' };
    if (on === 'tab') {
        if (key === 'ArrowUp') return { tier: -1, focus: 'tab' };
        if (key === 'ArrowDown') return { tier: 1, focus: 'tab' };
        if (key === 'ArrowRight' || key === 'Enter') return { focus: 'card' };
        return null;
    }
    if (on === 'card') {
        if (key === 'ArrowLeft') return { across: -1 };
        if (key === 'ArrowRight') return { across: 1 };
        if (key === 'ArrowUp') return { row: -1 };
        if (key === 'ArrowDown') return { row: 1 };
        if (key === 'Home') return { edge: 'first' };
        if (key === 'End') return { edge: 'last' };
        if (key === 'Enter') return { play: true };
        // Space drops the piece on the board: in the atlas it does nothing, never a play.
        if (key === ' ') return { hold: true };
        return null;
    }
    // Focus on a button or the page: an arrow brings it back to the selected card.
    if (key.startsWith('Arrow')) return { focus: 'card' };
    return null;
}

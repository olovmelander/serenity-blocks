import { formatOdysseyMapObjective } from './objective-copy.js';

const CASCADE_RULE = 'A cascade counts when falling blocks clear again.';
const CHAIN_RULE = 'One locked piece must trigger the whole chain; the first clear is wave one.';
// A clear sends one row fewer than the lines one piece cleared, cascade waves included
// (src/core/garbage.js), so a single sends nothing; any top-out ends the round.
const ATTACK_RULE = 'Clear two or more lines with one piece to send attack rows. '
    + 'Topping out the rival with an attack scores a knockout.';
const RESET_RULE = 'Both wells reset after every top-out.';
const MULTIPLIER_RULE = 'Clears on consecutive pieces raise your score multiplier.';
const MIRROR_RULE = 'Left and right controls are reversed.';
const QUAD_RULE = 'A Quad is four lines cleared by one piece: leave one column open for a long I piece.';
const RUBBLE_RULE = 'Rubble rows have gaps: clear the rows above them, then fill the gaps to break each row.';
const SURVIVAL_RULE = 'Stay alive until the timer reaches the goal, then keep going: '
    + 'every extra second counts toward your stars.';

function positiveNumber(value) {
    return Number.isFinite(value) && value > 0 ? value : null;
}

function getDeadline(level) {
    const failure = level?.victory?.failure;
    const seconds = failure?.type === 'time' ? positiveNumber(failure.value) : null;
    if (seconds === null) return null;
    const minutes = Math.floor(seconds / 60);
    const remainder = String(seconds % 60).padStart(2, '0');
    const duration = seconds < 60 ? `${seconds} seconds` : `${minutes}:${remainder}`;
    return `Reach the goal within ${duration}.`;
}

function getBoard(level) {
    const board = level?.mechanics?.board;
    const rows = positiveNumber(board?.rows);
    if (!rows) return null;
    // Match the engine's four-row starting clearance, without exposing hidden rows. A prepared opening
    // (authored rows) is set up for the player rather than dug through.
    const prepared = Array.isArray(board.opening) ? board.opening.length : 0;
    const requested = Math.max(0, Math.floor(Number(prepared || board.startingRows) || 0));
    const startingRows = Math.min(requested, Math.max(0, rows - 4));
    const rowWord = startingRows === 1 ? 'row' : 'rows';
    let opening = 'starts empty';
    if (startingRows > 0) {
        opening = prepared ? `${startingRows} ${rowWord} set up for you` : `${startingRows} ${rowWord} to dig through`;
    }
    return { rows, startingRows, text: `${rows}-row well · ${opening}.` };
}

function hasModifier(level, id) {
    return level?.modifiers?.active?.includes(id) === true;
}

function getGoalRule(level) {
    const type = level?.victory?.primary?.type;
    if (type === 'cascade') return CASCADE_RULE;
    if (type === 'combo') return CHAIN_RULE;
    if (type === 'tetrises') return QUAD_RULE;
    if (type === 'rubble') return RUBBLE_RULE;
    if (type === 'time') return SURVIVAL_RULE;
    return null;
}

/** A survival ramp in words: "The pieces fall twice as fast every 2:30." (phase 3) */
function getSpeedRamp(level) {
    const seconds = positiveNumber(level?.mechanics?.speed?.doublingSeconds);
    if (!seconds) return null;
    const every = seconds % 60 === 0 ? `${seconds / 60} minute${seconds === 60 ? '' : 's'}`
        : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    return `The pieces fall twice as fast every ${every}.`;
}

function hasSpeedProgression(level) {
    const explicit = level?.mechanics?.speed?.levelProgression;
    if (typeof explicit === 'boolean') return explicit;
    const baseMode = level?.mechanics?.baseMode;
    return baseMode ? baseMode !== 'infinity' : null;
}

function getGoal(level) {
    const primary = level?.victory?.primary;
    if (!primary || !positiveNumber(primary.target)) return 'Clear the orb';
    if (primary.type === 'height') return `Build to ${primary.target} rows`;
    if (!['lines', 'score', 'cascade', 'time', 'combo', 'tetrises', 'rubble', 'frags'].includes(primary.type)) {
        return 'Clear the orb';
    }
    return formatOdysseyMapObjective(primary);
}

/**
 * Brief a resolved runtime level, including its composed tuning and duel overrides.
 * Goal targets are shown once; changed cues explain what the player does differently.
 * No base-mode label is treated as a new cascade rule: all Odyssey modes cascade.
 */
export function getOdysseyLevelBriefing(nextLevel, previousLevel = null) {
    if (!nextLevel || typeof nextLevel !== 'object') {
        return {
            goal: 'Clear the orb', changes: [], rules: [], deadline: null,
        };
    }
    const goal = getGoal(nextLevel);
    const deadline = getDeadline(nextLevel);
    const board = getBoard(nextLevel);
    const duel = nextLevel?.mechanics?.versus;
    const goalRule = getGoalRule(nextLevel);
    const mirror = hasModifier(nextLevel, 'mirror');
    const multiplier = hasModifier(nextLevel, 'combo-multiplier');
    const rules = [
        deadline,
        mirror && MIRROR_RULE,
        duel && ATTACK_RULE,
        goalRule,
        !duel && board && (board.rows !== 20 || board.startingRows > 0) && board.text,
        multiplier && MULTIPLIER_RULE,
        getSpeedRamp(nextLevel),
        hasModifier(nextLevel, 'speed-up') && 'Pieces fall 50% faster.',
        hasModifier(nextLevel, 'slow-start') && 'Opening drop speed is slower.',
    ].filter(Boolean);
    if (!previousLevel) {
        return {
            goal, changes: rules.slice(0, 3), rules, deadline,
        };
    }

    const changes = [];
    const previousDuel = previousLevel.mechanics?.versus;
    const previousDeadline = getDeadline(previousLevel);
    const previousBoard = getBoard(previousLevel);
    const mirrorChanged = mirror !== hasModifier(previousLevel, 'mirror');
    if (mirrorChanged) changes.push(mirror ? MIRROR_RULE : 'Left and right controls return to normal.');
    if (deadline !== previousDeadline) {
        changes.push(deadline || 'No time limit on this orb.');
    }
    if (duel && !previousDuel) changes.push(ATTACK_RULE, RESET_RULE);
    if (!duel && previousDuel) changes.push('Solo play resumes; topping out ends the attempt.');
    if (goalRule && goalRule !== getGoalRule(previousLevel)) changes.push(goalRule);
    if (hasModifier(nextLevel, 'speed-up') !== hasModifier(previousLevel, 'speed-up')) {
        changes.push(hasModifier(nextLevel, 'speed-up')
            ? 'Pieces fall 50% faster.' : 'The extra drop-speed boost is gone.');
    }
    if (board && board.text !== previousBoard?.text) changes.push(board.text);
    if (multiplier !== hasModifier(previousLevel, 'combo-multiplier')) {
        changes.push(multiplier ? MULTIPLIER_RULE : 'Consecutive clears no longer multiply the score.');
    }
    if (hasModifier(nextLevel, 'slow-start') !== hasModifier(previousLevel, 'slow-start')) {
        changes.push(hasModifier(nextLevel, 'slow-start')
            ? 'Opening drop speed is slower.' : 'The slower opening is gone.');
    }
    const ramp = getSpeedRamp(nextLevel);
    if (ramp && ramp !== getSpeedRamp(previousLevel)) changes.push(ramp);
    const progression = hasSpeedProgression(nextLevel);
    const previousProgression = hasSpeedProgression(previousLevel);
    if (!ramp && !getSpeedRamp(previousLevel)
        && progression !== null && previousProgression !== null && progression !== previousProgression) {
        changes.push(progression ? 'Drop speed increases as you clear lines.' : 'Drop speed stays steady.');
    }
    // Keep routine handoffs brief; a changed deadline or controls may need a third cue.
    const limit = mirrorChanged || deadline !== previousDeadline ? 3 : 2;
    return {
        goal, changes: [...new Set(changes)].slice(0, limit), rules, deadline,
    };
}

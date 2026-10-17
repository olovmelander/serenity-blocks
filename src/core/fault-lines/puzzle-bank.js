// @ts-check

/**
 * The first Fault Lines pyramid: twelve puzzles in three tiers. Tier 1 teaches with one
 * piece each; tiers 2 and 3 deal two. A tier opens once two puzzles below it are solved.
 *
 * Authoring convention: lowercase letters are lanterns, bodies hanging in the air. They
 * follow the same rule as every body (they fall only once a row beneath them clears);
 * the case only tells an author which ones hang.
 *
 * Tier 2 and 3 structures came from an offline search over random structures, kept only
 * when few openings lead to a solution, then named and ordered by hand. The certifier
 * test (tests/unit/fault-lines-puzzles.test.js) solves every one on each run.
 */

/** @typedef {import('./fault-lines-puzzle.js').FaultLinesDefinition & { tier: number }} BankPuzzle */

/** @type {readonly BankPuzzle[]} */
export const FAULT_LINES_PUZZLES = Object.freeze([
    {
        id: 'first-fall',
        tier: 1,
        title: 'First fall',
        lesson: 'Fill the gap. The row clears, and what stood on it falls.',
        rows: [
            '.AA.......',
            'BBBBBB.CCC',
        ],
        supply: ['I'],
        goal: { type: 'lines', atLeast: 1 },
    },
    {
        id: 'second-wave',
        tier: 1,
        title: 'Second wave',
        lesson: 'A falling body can finish the row beneath it.',
        rows: [
            '......l...',
            '..........',
            '..........',
            'AAAAA.CCCC',
            'BBBBBB.DDD',
        ],
        supply: ['I'],
        goal: { type: 'waves', atLeast: 2 },
    },
    {
        id: 'lanterns',
        tier: 1,
        title: 'Lanterns',
        lesson: 'Lanterns hang until a row beneath them clears. Then they fall.',
        rows: [
            '......ll..',
            '..........',
            '....AAAAAA',
            'CCCCCC..DD',
        ],
        supply: ['I'],
        goal: { type: 'clear-all' },
    },
    {
        id: 'lantern-rain',
        tier: 1,
        title: 'Lantern rain',
        lesson: 'Every lantern falls at once. Each lands where it hangs.',
        rows: [
            '..l...m...',
            '..........',
            'AAAAAAAA.B',
            'CC.DDDDDDD',
            'EEEEEE.FFF',
        ],
        supply: ['I'],
        goal: { type: 'waves', atLeast: 3 },
    },
    {
        id: 'staircase',
        tier: 1,
        title: 'Staircase',
        lesson: 'One clear lets the next lantern down.',
        rows: [
            '..l....m.n',
            '..........',
            '..........',
            '..........',
            '..........',
            'AAAA.BBBBB',
            'CCCCCCC.DD',
            'EE.FFFFFFF',
            'GGGGGGGGG.',
        ],
        supply: ['I'],
        goal: { type: 'waves', atLeast: 4 },
    },
    {
        id: 'the-relic',
        tier: 2,
        title: 'The relic',
        lesson: 'Bring the relic to the floor. Clear what holds it up.',
        rows: [
            '....R.....',
            'AAAAAAAA..',
            'BBBBBBBB..',
            'CCCCCCCC..',
        ],
        supply: ['I', 'I'],
        goal: { type: 'relic-floor', body: 'R' },
    },
    {
        id: 'slip',
        tier: 2,
        title: 'Slip',
        lesson: 'What a clear leaves of your piece keeps falling.',
        rows: [
            'AAAAA..CCC',
            'DDDDDD..FG',
            'HJJJJJ..MM',
        ],
        supply: ['S', 'L'],
        goal: { type: 'waves', atLeast: 2 },
    },
    {
        id: 'what-remains',
        tier: 2,
        title: 'What remains',
        lesson: 'Your pieces become bodies too. Leave one where it can fall.',
        rows: [
            '.........a',
            '..........',
            '..........',
            'BBCCCCCCC.',
            'EEEEEEEE..',
        ],
        supply: ['L', 'T'],
        goal: { type: 'waves', atLeast: 2 },
    },
    {
        id: 'clean-sweep',
        tier: 3,
        title: 'Clean sweep',
        lesson: 'Leave nothing behind.',
        rows: [
            'AAAAAAA..D',
            'EEEEEEEE..',
            'HJJJJJK..N',
            'PPPPPP..SS',
        ],
        supply: ['Z', 'T'],
        goal: { type: 'clear-all' },
    },
    {
        id: 'ride-the-lantern',
        tier: 3,
        title: 'Ride the lantern',
        lesson: 'A piece resting on a lantern falls with it.',
        rows: [
            '.........b',
            'a.........',
            '..........',
            'BBBCCC..EE',
            '.GGGHHHHHH',
            'KKKKMMM.NN',
            '.QQQQSSSSS',
        ],
        supply: ['I', 'J'],
        goal: { type: 'waves', atLeast: 4 },
    },
    {
        id: 'keyhole',
        tier: 3,
        title: 'Keyhole',
        lesson: 'Only one way in goes all the way down.',
        rows: [
            '......ba..',
            '..........',
            'AAAAAAA.BB',
            'CCC..EEEFF',
            'GGG..KKKKK',
        ],
        supply: ['L', 'T'],
        goal: { type: 'waves', atLeast: 2 },
    },
    {
        id: 'lean-to',
        tier: 3,
        title: 'Lean-to',
        lesson: 'Prop a piece against a lantern, then let them fall together.',
        rows: [
            '..b.......',
            '.......a..',
            '..CCCDDDDD',
            'EEE..GGGGG',
            'HHH.JJJKKK',
            'NP.QQQQQQQ',
        ],
        supply: ['L', 'O'],
        goal: { type: 'waves', atLeast: 4 },
    },
]);

/** Puzzles solved in a tier before the next one opens. */
export const SOLVES_TO_OPEN_NEXT_TIER = 2;

/**
 * Ids of the puzzles a player can choose, given the ones they've solved.
 * @param {Iterable<string>} solvedIds
 * @param {readonly BankPuzzle[]} [bank]
 * @returns {Set<string>}
 */
export function openPuzzleIds(solvedIds, bank = FAULT_LINES_PUZZLES) {
    const solved = new Set(solvedIds);
    const open = new Set();
    const tiers = [...new Set(bank.map((puzzle) => puzzle.tier))].sort((a, b) => a - b);
    for (const [index, tier] of tiers.entries()) {
        if (index > 0) {
            const below = bank.filter((puzzle) => puzzle.tier === tiers[index - 1]);
            if (below.filter((puzzle) => solved.has(puzzle.id)).length < SOLVES_TO_OPEN_NEXT_TIER) break;
        }
        bank.filter((puzzle) => puzzle.tier === tier).forEach((puzzle) => open.add(puzzle.id));
    }
    return open;
}

/**
 * @param {string} id
 * @returns {BankPuzzle | null}
 */
export function bankPuzzle(id) {
    return FAULT_LINES_PUZZLES.find((puzzle) => puzzle.id === id) || null;
}

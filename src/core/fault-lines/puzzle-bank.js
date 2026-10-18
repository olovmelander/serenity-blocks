// @ts-check

/**
 * The first Fault Lines pyramid: fifteen puzzles in three tiers of five. Tier 1 teaches
 * with one piece each; tiers 2 and 3 deal two. A tier opens once three puzzles below it
 * are solved, so a player always meets the lanterns before the deep fault assumes them.
 *
 * Authoring convention: lowercase letters are lanterns, bodies hanging in the air. They
 * follow the same rule as every body (they fall only once a row beneath them clears);
 * the case only tells an author which ones hang.
 *
 * Every puzzle has a straight-drop solution (rotate and move at the top, then drop): no
 * puzzle depends on a tuck or a kick. In the two-piece tiers the last piece is needed
 * (nothing solves before it lands) and every piece matters (the puzzle is unsolvable
 * without its first piece). `solution` is one such line of play, for the hint; the
 * certifier (tests/unit/fault-lines-puzzles.test.js) proves all of this on every run.
 *
 * Tier 2 and 3 structures came from an offline search over random structures under those
 * rules, kept when few openings win, then named and ordered by hand.
 */

/** @typedef {import('./fault-lines-puzzle.js').FaultLinesDefinition & { tier: number }} BankPuzzle */

/** The tiers, in order, as the player sees them. */
export const TIERS = Object.freeze([
    { tier: 1, name: 'First light' },
    { tier: 2, name: 'Undertow' },
    { tier: 3, name: 'Deep fault' },
]);

/** @type {readonly BankPuzzle[]} */
export const FAULT_LINES_PUZZLES = Object.freeze([
    // ── Tier 1: one piece, one idea each ──
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
        solution: [{ piece: 'I', rotation: 1, x: 4 }],
    },
    {
        id: 'second-wave',
        tier: 1,
        title: 'Second wave',
        lesson: 'What falls can finish the row beneath it. Every clear after the first is another wave.',
        rows: [
            '......E...',
            'AAAAA.CCCC',
            'BBBBBB.DDD',
        ],
        supply: ['I'],
        goal: { type: 'waves', atLeast: 2 },
        solution: [{ piece: 'I', rotation: 1, x: 3 }],
    },
    {
        id: 'lanterns',
        tier: 1,
        title: 'Lanterns',
        lesson: 'Lanterns hang in the air. The first clear lets every one of them fall.',
        rows: [
            '......ll..',
            '..........',
            '....AAAAAA',
            'CCCCCC..DD',
        ],
        supply: ['I'],
        goal: { type: 'clear-all' },
        solution: [{ piece: 'I', rotation: 0, x: 0 }],
    },
    {
        id: 'lantern-rain',
        tier: 1,
        title: 'Lantern rain',
        lesson: 'Every lantern drops straight down, all at once. Look at what waits beneath each one.',
        rows: [
            '..l...m...',
            '..........',
            'AAAAAAAA.B',
            'CC.DDDDDDD',
            'EEEEEE.FFF',
        ],
        supply: ['I'],
        goal: { type: 'waves', atLeast: 3 },
        solution: [{ piece: 'I', rotation: 1, x: 6 }],
    },
    {
        id: 'staircase',
        tier: 1,
        title: 'Staircase',
        lesson: 'Each clear lets the next lantern down.',
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
        solution: [{ piece: 'I', rotation: 3, x: 3 }],
    },

    // ── Tier 2: two pieces, both needed ──
    {
        id: 'the-relic',
        tier: 2,
        title: 'The relic',
        lesson: 'Clear everything under the relic, and it comes down.',
        rows: [
            '....R.....',
            'AAAAAAAA..',
            'BBBBBBBB..',
            'CCCCCCCC..',
        ],
        supply: ['I', 'I'],
        goal: { type: 'relic-floor', body: 'R' },
        solution: [{ piece: 'I', rotation: 1, x: 6 }, { piece: 'I', rotation: 1, x: 7 }],
    },
    {
        id: 'footing',
        tier: 2,
        title: 'Footing',
        lesson: 'Your pieces become bodies too. Park one above a gap, then clear the row it stands on.',
        rows: [
            'BBCCCCCCC.',
            'EEEEEE..GG',
        ],
        supply: ['O', 'I'],
        goal: { type: 'waves', atLeast: 2 },
        solution: [{ piece: 'O', rotation: 0, x: 6 }, { piece: 'I', rotation: 1, x: 7 }],
    },
    {
        id: 'slip',
        tier: 2,
        title: 'Slip',
        lesson: 'A clear can cut your piece. What is left keeps falling.',
        rows: [
            'AAAAA..CCC',
            'DDDDDD..FG',
            'HJJJJJ..MM',
            'NNNNNNN.PP',
        ],
        supply: ['S', 'J'],
        goal: { type: 'lines', atLeast: 4 },
        solution: [{ piece: 'S', rotation: 1, x: 4 }, { piece: 'J', rotation: 1, x: 6 }],
    },
    {
        id: 'clean-sweep',
        tier: 2,
        title: 'Clean sweep',
        lesson: 'Leave nothing behind. A lone block drops the moment the row under it opens.',
        rows: [
            'AAAAAAAA..',
            'EEEEEEEE..',
            'HJJJJJK..N',
            'PPPPPP..SS',
        ],
        supply: ['O', 'T'],
        goal: { type: 'clear-all' },
        solution: [{ piece: 'O', rotation: 0, x: 8 }, { piece: 'T', rotation: 2, x: 6 }],
    },
    {
        id: 'undermine',
        tier: 2,
        title: 'Undermine',
        lesson: 'Clear what holds the relic. What is left of your pieces can open the floor.',
        rows: [
            '.....R....',
            'AB.CCCCCCC',
            '.EEEFFFFFF',
        ],
        supply: ['J', 'L'],
        goal: { type: 'relic-floor', body: 'R' },
        solution: [{ piece: 'J', rotation: 3, x: -1 }, { piece: 'L', rotation: 0, x: 2 }],
    },

    // ── Tier 3: the deep fault ──
    {
        id: 'stairwell',
        tier: 3,
        title: 'Stairwell',
        lesson: 'Each clear lets a standing piece down one row. Line the gaps up.',
        rows: [
            '..CCCCCCCC',
            'D.FFFFFFFF',
            'GG.HHHJJJJ',
        ],
        supply: ['J', 'J'],
        goal: { type: 'waves', atLeast: 3 },
        solution: [{ piece: 'J', rotation: 3, x: 1 }, { piece: 'J', rotation: 1, x: 0 }],
    },
    {
        id: 'lantern-well',
        tier: 3,
        title: 'Lantern well',
        lesson: 'A standing piece and the lanterns fall together. Each fills the gap beneath it.',
        rows: [
            'a.......c.',
            'AABB..DDDD',
            'EEFF..HHHH',
            'JJKKKKK..N',
            '.QQQQSSSSS',
        ],
        supply: ['I', 'S'],
        goal: { type: 'waves', atLeast: 4 },
        solution: [{ piece: 'I', rotation: 1, x: 5 }, { piece: 'S', rotation: 3, x: 4 }],
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
        solution: [{ piece: 'I', rotation: 3, x: -1 }, { piece: 'J', rotation: 1, x: 6 }],
    },
    {
        id: 'lean-to',
        tier: 3,
        title: 'Lean-to',
        lesson: 'Your piece can be the staircase. Each row it finishes lets the lantern beside it down one more.',
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
        solution: [{ piece: 'L', rotation: 3, x: 2 }, { piece: 'O', rotation: 0, x: 0 }],
    },
    {
        id: 'four-gaps',
        tier: 3,
        title: 'Four gaps',
        lesson: 'Four gaps, two pieces. Set one over the gaps, then fire the other.',
        rows: [
            'BBBBB.CCCD',
            'EEEE.FFFGG',
            'HHJ..MMMNN',
            'QQQQ.SSTTT',
        ],
        supply: ['T', 'Z'],
        goal: { type: 'waves', atLeast: 4 },
        solution: [{ piece: 'T', rotation: 1, x: 3 }, { piece: 'Z', rotation: 1, x: 4 }],
    },
]);

/** Puzzles solved in a tier before the next one opens. */
export const SOLVES_TO_OPEN_NEXT_TIER = 3;

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

/** @param {number} tier */
export function tierName(tier) {
    return TIERS.find((entry) => entry.tier === tier)?.name || `Tier ${tier}`;
}

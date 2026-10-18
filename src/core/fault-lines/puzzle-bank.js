// @ts-check

/**
 * The Fault Lines pyramid: thirty-six puzzles in six tiers. First light teaches with one
 * piece each; Undertow and Deep fault deal two; Rift, Bedrock and Epicentre deal three, and
 * from Bedrock on exactly one first landing leads anywhere. A tier opens once three puzzles
 * below it are solved, so a player always meets the lanterns before the deep fault assumes
 * them.
 *
 * Authoring convention: lowercase letters are lanterns, bodies hanging in the air. They
 * follow the same rule as every body (they fall only once a row beneath them clears);
 * the case only tells an author which ones hang.
 *
 * Every puzzle has a straight-drop solution (rotate and move at the top, then drop): no
 * puzzle depends on a tuck or a kick. In the two-piece tiers the last piece is needed
 * (nothing solves before it lands) and every piece matters (the puzzle is unsolvable
 * without its leading pieces). `solution` is one such line of play, for the hint; the
 * certifier (tests/unit/fault-lines-puzzles.test.js) proves all of this on every run.
 *
 * Structures from tier 2 on came from an offline search over random structures under those
 * rules (scripts/fault-lines-search.mjs), kept when few openings win and the greedy opening
 * loses, then named and ordered by hand.
 */

/** @typedef {import('./fault-lines-puzzle.js').FaultLinesDefinition & { tier: number }} BankPuzzle */

/** The tiers, in order, as the player sees them. */
export const TIERS = Object.freeze([
    { tier: 1, name: 'First light' },
    { tier: 2, name: 'Undertow' },
    { tier: 3, name: 'Deep fault' },
    { tier: 4, name: 'Rift' },
    { tier: 5, name: 'Bedrock' },
    { tier: 6, name: 'Epicentre' },
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
        id: 'lantern-home',
        tier: 2,
        title: 'Lantern home',
        lesson: 'A lantern can be the relic. It reaches the floor only once both rows beneath it are gone.',
        rows: [
            'a.........',
            '..........',
            '..........',
            'ABBBBCC.DD',
            'EEEF.GGGGG',
        ],
        supply: ['I', 'I'],
        goal: { type: 'relic-floor', body: 'a' },
        solution: [{ piece: 'I', rotation: 3, x: 3 }, { piece: 'I', rotation: 1, x: 5 }],
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
        id: 'top-down',
        tier: 2,
        title: 'Top down',
        lesson: 'Four lines from two pieces. After the first clear, what is left of each one finishes the rows below.',
        rows: [
            'ABBBBC.DDD',
            'AAAACCC.EE',
            'FFFGGG.HHH',
            'FFFJJJJ.KK',
        ],
        supply: ['L', 'J'],
        goal: { type: 'lines', atLeast: 4 },
        solution: [{ piece: 'L', rotation: 1, x: 5 }, { piece: 'J', rotation: 3, x: 6 }],
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
        id: 'trapdoor',
        tier: 3,
        title: 'Trapdoor',
        lesson: 'The lone block over the gap is a trapdoor. Load it, then clear its row.',
        rows: [
            'AAAAa.BBBB',
            'CCDD.EEEFF',
            'GHH..JJJKK',
        ],
        supply: ['T', 'L'],
        goal: { type: 'waves', atLeast: 3 },
        solution: [{ piece: 'T', rotation: 1, x: 3 }, { piece: 'L', rotation: 0, x: 5 }],
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
    {
        id: 'landslide',
        tier: 3,
        title: 'Landslide',
        lesson: 'Ride the lantern again, deeper. Lantern and piece fall together, and each fills a gap of its own.',
        rows: [
            '..a.......',
            '..........',
            'AAABBB.CCC',
            'AA.BBBDDDD',
            'EEEEFF.GGG',
            '.HHFFF..GG',
            'HHHJJJK.MM',
        ],
        supply: ['L', 'J'],
        goal: { type: 'waves', atLeast: 4 },
        solution: [{ piece: 'L', rotation: 0, x: 0 }, { piece: 'J', rotation: 3, x: 5 }],
    },

    // ── Tier 4: three pieces, two set and one fired ──
    {
        id: 'double-footing',
        tier: 4,
        title: 'Double footing',
        lesson: 'Bring the lantern down: stand a piece over each low gap, then clear the row they stand on.',
        rows: [
            '........a.',
            '........a.',
            '..........',
            '..........',
            '..........',
            'AAA..BBBBC',
            '.DDDDB.CCC',
        ],
        supply: ['L', 'I', 'J'],
        goal: { type: 'relic-floor', body: 'a' },
        solution: [
            { piece: 'L', rotation: 0, x: 0 },
            { piece: 'I', rotation: 1, x: 4 },
            { piece: 'J', rotation: 1, x: 3 },
        ],
    },
    {
        id: 'row-of-your-own',
        tier: 4,
        title: 'Row of your own',
        lesson: 'Lay a row of your own on top. When it clears, the blocks left above it fall into the gaps below.',
        rows: [
            'AAAAABBCC.',
            'DDDD.EFFGG',
        ],
        supply: ['J', 'L', 'I'],
        goal: { type: 'clear-all' },
        solution: [
            { piece: 'J', rotation: 2, x: 4 },
            { piece: 'L', rotation: 2, x: 7 },
            { piece: 'I', rotation: 0, x: 0 },
        ],
    },
    {
        id: 'on-the-ledge',
        tier: 4,
        title: 'On the ledge',
        lesson: 'Set two pieces on the ledge, each above the gap it will fall into. The third piece starts the fall.',
        rows: [
            'AAAABBB.CC',
            'DDDEE.FCCC',
            'D.GGGHHHHJ',
        ],
        supply: ['L', 'Z', 'L'],
        goal: { type: 'waves', atLeast: 3 },
        solution: [
            { piece: 'L', rotation: 1, x: 0 },
            { piece: 'Z', rotation: 1, x: 4 },
            { piece: 'L', rotation: 0, x: 7 },
        ],
    },
    {
        id: 'side-by-side',
        tier: 4,
        title: 'Side by side',
        lesson: 'Two pieces on one ledge, side by side. The first clear brings both down, each into a gap of its own.',
        rows: [
            'AAAABB.CDD',
            'EEE.CCCCCF',
            'GG.HHHJJKK',
        ],
        supply: ['J', 'J', 'L'],
        goal: { type: 'waves', atLeast: 3 },
        solution: [
            { piece: 'J', rotation: 0, x: 0 },
            { piece: 'J', rotation: 3, x: 2 },
            { piece: 'L', rotation: 1, x: 5 },
        ],
    },
    {
        id: 'overhead',
        tier: 4,
        title: 'Overhead',
        lesson: 'Each gap needs something waiting above it. Count the lanterns too.',
        rows: [
            '...aa.....',
            '........AA',
            'BBBCCD.EEE',
            'B.FFFFGGG.',
        ],
        supply: ['T', 'I', 'T'],
        goal: { type: 'waves', atLeast: 3 },
        solution: [
            { piece: 'T', rotation: 0, x: 0 },
            { piece: 'I', rotation: 1, x: 7 },
            { piece: 'T', rotation: 0, x: 5 },
        ],
    },
    {
        id: 'clear-path',
        tier: 4,
        title: 'Clear path',
        lesson: 'Bring the lantern to the floor. Nothing of yours may end up beneath it.',
        rows: [
            '..aa......',
            '.......A..',
            '.......A..',
            'B.CCCDDD.E',
            'FFFF..G.HH',
        ],
        supply: ['L', 'S', 'J'],
        goal: { type: 'relic-floor', body: 'a' },
        solution: [
            { piece: 'L', rotation: 1, x: 0 },
            { piece: 'S', rotation: 0, x: 4 },
            { piece: 'J', rotation: 3, x: 7 },
        ],
    },

    // ── Tier 5: one way in ──
    {
        id: 'riders',
        tier: 5,
        title: 'Riders',
        lesson: 'Load the lantern, then give it somewhere to fall. Whatever rides it comes down too.',
        rows: [
            '......aa..',
            '..........',
            '..........',
            'ABBBC.DDDD',
            'AAAAEEEE.F',
            'GGGHHJ..KM',
            'NNNNNPP.QQ',
        ],
        supply: ['J', 'L', 'S'],
        goal: { type: 'waves', atLeast: 4 },
        solution: [
            { piece: 'J', rotation: 3, x: 7 },
            { piece: 'L', rotation: 1, x: 6 },
            { piece: 'S', rotation: 3, x: 4 },
        ],
    },
    {
        id: 'crown',
        tier: 5,
        title: 'Crown',
        lesson: 'The top row is mostly air. Fill it, and what you leave above the gaps comes down after it.',
        rows: [
            'A.......BB',
            'A........B',
            'CDDEE.FFGG',
            'CCHHHHHJJ.',
            'KKKH.MMNNP',
        ],
        supply: ['L', 'O', 'Z'],
        goal: { type: 'waves', atLeast: 4 },
        solution: [
            { piece: 'L', rotation: 0, x: 1 },
            { piece: 'O', rotation: 0, x: 6 },
            { piece: 'Z', rotation: 3, x: 4 },
        ],
    },
    {
        id: 'keep-the-relic',
        tier: 5,
        title: 'Keep the relic',
        lesson: 'Clear the floor row, but never the row the relic is in. A lantern that falls fills gaps too.',
        rows: [
            'ABBaa.CCCC',
            'DEE...FFFF',
        ],
        supply: ['L', 'J', 'I'],
        goal: { type: 'relic-floor', body: 'A' },
        solution: [
            { piece: 'L', rotation: 2, x: 3 },
            { piece: 'J', rotation: 2, x: 0 },
            { piece: 'I', rotation: 0, x: 6 },
        ],
    },
    {
        id: 'lantern-fall',
        tier: 5,
        title: 'Lantern fall',
        lesson: 'The lantern comes down in two drops; the second must reach the floor. Ready the wall first.',
        rows: [
            '...aa.....',
            '...a......',
            '..........',
            '..........',
            'AAAABBBC.b',
            'DDDDEFFGG.',
            '.HJJJJFFFK',
            'MMM.NNNNNP',
        ],
        supply: ['T', 'S', 'L'],
        goal: { type: 'relic-floor', body: 'a' },
        solution: [
            { piece: 'T', rotation: 3, x: -1 },
            { piece: 'S', rotation: 1, x: 6 },
            { piece: 'L', rotation: 1, x: 8 },
        ],
    },
    {
        id: 'nothing-left',
        tier: 5,
        title: 'Nothing left',
        lesson: 'Every block must go, the lantern too. It lands in a row your pieces finish.',
        rows: [
            'a.........',
            '..........',
            '..........',
            'AAAABB.CC.',
            'DDDDEE.FFG',
        ],
        supply: ['J', 'T', 'I'],
        goal: { type: 'clear-all' },
        solution: [
            { piece: 'J', rotation: 0, x: 7 },
            { piece: 'T', rotation: 1, x: 5 },
            { piece: 'I', rotation: 0, x: 1 },
        ],
    },
    {
        id: 'third-row',
        tier: 5,
        title: 'Third row',
        lesson: 'Two rows, three pieces, and nothing may be left. Build the third row yourself.',
        rows: [
            'AAABBCDDE.',
            'F.GGBBBBHH',
        ],
        supply: ['L', 'I', 'T'],
        goal: { type: 'clear-all' },
        solution: [
            { piece: 'L', rotation: 2, x: 7 },
            { piece: 'I', rotation: 0, x: 3 },
            { piece: 'T', rotation: 2, x: 0 },
        ],
    },

    // ── Tier 6: one way in, the deepest goals ──
    {
        id: 'corners',
        tier: 6,
        title: 'Corners',
        lesson: 'Both corners need a piece waiting. The middle is where it starts.',
        rows: [
            'AABB.CCCDD',
            'EEEEECCC.F',
            '.GGGHHHHHJ',
            'KKKK.MMNNN',
            'PPPPMMQR.S',
        ],
        supply: ['J', 'Z', 'I'],
        goal: { type: 'waves', atLeast: 5 },
        solution: [
            { piece: 'J', rotation: 3, x: 7 },
            { piece: 'Z', rotation: 3, x: 0 },
            { piece: 'I', rotation: 3, x: 3 },
        ],
    },
    {
        id: 'standing-stone',
        tier: 6,
        title: 'Standing stone',
        lesson: 'The standing stone fills a gap too. Give every other gap a piece of yours.',
        rows: [
            '....A.....',
            '....A.....',
            '.BBBBCCCCa',
            'DDDD.EEEF.',
            'GGGEEE.HHJ',
            'KKKMM..NPP',
            '.QQRRR.PPP',
        ],
        supply: ['L', 'S', 'J'],
        goal: { type: 'waves', atLeast: 5 },
        solution: [
            { piece: 'L', rotation: 1, x: 5 },
            { piece: 'S', rotation: 1, x: 7 },
            { piece: 'J', rotation: 3, x: -1 },
        ],
    },
    {
        id: 'two-hooks',
        tier: 6,
        title: 'Two hooks',
        lesson: 'The hooks come down with everything else. One of your pieces belongs against the wall.',
        rows: [
            '.AA....BB.',
            '..A....B..',
            'CCCD.EEFFF',
            'GGHHHJJ.FF',
            '.KKKKKMMMM',
            'NNNPPP.QQQ',
            'RR.SSSSTTT',
        ],
        supply: ['L', 'I', 'T'],
        goal: { type: 'waves', atLeast: 5 },
        solution: [
            { piece: 'L', rotation: 1, x: 5 },
            { piece: 'I', rotation: 3, x: -1 },
            { piece: 'T', rotation: 1, x: 3 },
        ],
    },
    {
        id: 'fault-line',
        tier: 6,
        title: 'Fault line',
        lesson: 'Three rows share a gap in one column. All six rows must go.',
        rows: [
            'AAA.BBBCCC',
            '.DDDDDEEEF',
            'GGGHHH.JJJ',
            'KKKKKM.NNN',
            'PPPPQQ.RRR',
            'SSS.TTTTUU',
        ],
        supply: ['I', 'T', 'J'],
        goal: { type: 'lines', atLeast: 6 },
        solution: [
            { piece: 'I', rotation: 1, x: 4 },
            { piece: 'T', rotation: 3, x: -1 },
            { piece: 'J', rotation: 3, x: 2 },
        ],
    },
    {
        id: 'plumb-line',
        tier: 6,
        title: 'Plumb line',
        lesson: 'Six rows, six waves. Every gap needs something waiting above it when the row over it goes.',
        rows: [
            'AAABBBa.CC',
            'AABBDD.EEE',
            'FFF.DDDEEE',
            'FFFGGGG.HH',
            'JJJb.KKKKK',
            'JJJ.MM.NNP',
        ],
        supply: ['I', 'T', 'I'],
        goal: { type: 'waves', atLeast: 6 },
        solution: [
            { piece: 'I', rotation: 1, x: 4 },
            { piece: 'T', rotation: 3, x: 2 },
            { piece: 'I', rotation: 1, x: 5 },
        ],
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

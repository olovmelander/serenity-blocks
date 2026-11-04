/**
 * Odyssey level design retune (docs/ODYSSEY_LEVEL_DESIGN_AUDIT_2026-11.md: phase 1 and 1b, and pass 2, §8).
 *
 * Applied to the assembled campaign, keyed by PUBLIC orb id, so every number here is the one the player
 * meets and the one the audit measured (3,600 shipped attempts against the same seeds). Generated from the
 * audit's proposal.json; each entry's comment is the audit's reason for the change.
 *
 * Merge rules match the benchmark's proposal scenario: objects merge, and star tiers, bonus lists, modifier
 * lists and rival overrides replace whole. Design rules R1-R9 are asserted by
 * tests/unit/odyssey-campaign-design-rules.test.js.
 */

import { formatOdysseyRival } from './duel-rules.js';

const REPLACE_KEYS = new Set(['one', 'two', 'three', 'bonuses', 'active', 'botOverrides']);

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
}

export const ODYSSEY_LEVEL_DESIGN_2026_11 = deepFreeze({
    // Remove the 2.25× speed cliff from the first orb of the game: it now eases 720 → 461 ms. Star times ask a
    // real pace (85 s, then 65 s without singles).
    1: {
        mechanics: { speed: { startLevel: 2, fixedDropInterval: 720, levelProgression: true } },
        stars: {
            one: { lines: 20 },
            two: { lines: 20, time: 85 },
            three: { lines: 20, time: 65, bonuses: 1 },
        },
    },
    // The second star was met by any cascade. Now two stars for a 3-wave chain or finishing within 40 pieces,
    // three for both. Phase 2 adds a prepared opening.
    2: {
        victory: {
            bonuses: [
                { type: 'max-cascade-depth', target: 3, description: 'Trigger a 3-wave chain' },
                { type: 'pieces', target: 40, description: 'Finish within 40 pieces' },
            ],
        },
        stars: {
            one: { cascades: 3 },
            two: { cascades: 3, bonuses: 1 },
            three: { cascades: 3, bonuses: 2 },
        },
        mechanics: { board: { opening: ['........X.', 'XXXXXXXX..', 'XXXXXXXXX.'] } },
    },
    // Same fix as orb 2, with a 45-piece budget.
    3: {
        victory: {
            bonuses: [
                { type: 'max-cascade-depth', target: 3, description: 'Trigger a 3-wave chain' },
                { type: 'pieces', target: 45, description: 'Finish within 45 pieces' },
            ],
        },
        stars: {
            one: { cascades: 4 },
            two: { cascades: 4, bonuses: 1 },
            three: { cascades: 4, bonuses: 2 },
        },
    },
    // Pace the first boss to what chapter 1 taught (420 → 246 ms instead of 205 → 120), 30 lines instead of 40.
    // Pass 2: its three stars came on their own in a cascade well, even at casual pace, so two stars ask for 4
    // cascades and three for 7 cascades and a 4-wave chain. A long run of cascades counts as much as the deep chain:
    // three stars ask for 7 cascades, a 3-wave chain, and either 11 cascades or a 4-wave chain.
    4: {
        mechanics: { speed: { startLevel: 3, fixedDropInterval: 420, levelProgression: true } },
        victory: {
            primary: { type: 'lines', target: 30 },
            bonuses: [
                { type: 'cascade', target: 11, description: 'Trigger 11 cascades' },
                { type: 'max-cascade-depth', target: 4, description: 'Trigger a 4-wave chain' },
            ],
        },
        modifiers: { active: ['gravity-cascade'] },
        stars: {
            one: { lines: 30 },
            two: { lines: 30, cascades: 4 },
            three: {
                lines: 30, cascades: 7, maxCascadeDepth: 3, bonuses: 1,
            },
        },
    },
    // Keep.
    5: { role: 'rival' },
    // Keep: a clean introduction to rubble. Three stars ask for the 2 Quads within 55 s, not a 150 s time nobody
    // misses.
    6: {
        stars: {
            one: { lines: 20 },
            two: { lines: 20, quads: 1 },
            three: { lines: 20, quads: 2, time: 55 },
        },
        role: 'teach',
    },
    // Keep; retag it as practice.
    7: { role: 'reinforce' },
    // The chapter's digging twist now digs: dig out the 6 rubble rows (phase 3's new goal) at chapter 2's pace
    // (450 → 331 ms instead of 320 → 151). Two and three stars for digging fast.
    8: {
        mechanics: {
            board: { startingRows: 6 },
            speed: { startLevel: 3, fixedDropInterval: 450, levelProgression: true },
        },
        victory: { primary: { type: 'rubble', target: 6 }, bonuses: [] },
        stars: {
            one: { rubbleCleared: 6 },
            two: { rubbleCleared: 6, time: 50 },
            three: { rubbleCleared: 6, time: 25 },
        },
        role: 'twist',
    },
    // The boss joins the chapter's two ideas: cascades out of a deep seabed (8 rubble rows, 8 cascades instead of
    // 10). Drop the inert multiplier and the uncounted 6-wave bonus.
    9: {
        mechanics: { board: { startingRows: 8 } },
        victory: { primary: { type: 'cascade', target: 8 }, bonuses: [] },
        modifiers: { active: ['gravity-cascade'] },
        stars: {
            one: { cascades: 8 },
            two: { cascades: 8, maxCascadeDepth: 3 },
            three: { cascades: 8, maxCascadeDepth: 4 },
        },
    },
    // Keep.
    10: { role: 'rival' },
    // Arrival at 450 → 331 ms instead of 205 → 120, with 26 lines. Star times ask a real pace.
    11: {
        mechanics: { speed: { startLevel: 3, fixedDropInterval: 450, levelProgression: true } },
        victory: { primary: { type: 'lines', target: 26 } },
        stars: {
            one: { lines: 26 },
            two: { lines: 26, time: 100 },
            three: { lines: 26, time: 75, bonuses: 1 },
        },
    },
    // Replace the copy of orb 1 with the campaign's missing lesson, the Quad: clear 3 Quads at a calm 600 ms. Two
    // stars for no singles or within 60 pieces, three for both. Phase 2 adds a prepared open-column well.
    12: {
        mechanics: {
            speed: { startLevel: 2, fixedDropInterval: 600, levelProgression: false },
            board: { opening: ['XXXXXXXXX.', 'XXXXXXXXX.', 'XXXXXXXXX.', 'XXXXXXXXX.'] },
        },
        victory: {
            primary: { type: 'quads', target: 3 },
            failure: { type: 'top-out', value: null },
            bonuses: [
                { type: 'no-singles', description: 'No single-line clears' },
                { type: 'pieces', target: 60, description: 'Finish within 60 pieces' },
            ],
        },
        stars: {
            one: { quads: 3 },
            two: { quads: 3, bonuses: 1 },
            three: { quads: 3, bonuses: 2 },
        },
        mechanicFocus: 'quads',
    },
    // The first score orb, taught as one: 450 → 263 ms instead of 320 → 151 (start level 3, so the target rises
    // 10% to 16,500). Stars: 2 Quads, then 4, which a Quad builder reaches before the goal; no chain.
    13: {
        mechanics: { speed: { startLevel: 3, fixedDropInterval: 450, levelProgression: true } },
        victory: {
            primary: { type: 'score', target: 16500 },
            bonuses: [{ type: 'quad-count', target: 4, description: 'Clear 4 Quads' }],
        },
        stars: {
            one: { score: 16500 },
            two: { score: 16500, quads: 2 },
            three: { score: 16500, quads: 4 },
        },
        role: 'teach',
    },
    // The first chain goal ("Trigger a 3-wave chain") instead of a third cascade lesson. Stars for building it on
    // purpose: within 100 pieces, then within 30. A prepared opening was tried and rejected (§5.9).
    14: {
        mechanics: { board: { startingRows: 2 } },
        victory: {
            primary: { type: 'combo', target: 3 },
            bonuses: [
                { type: 'pieces', target: 100, description: 'Finish within 100 pieces' },
                { type: 'pieces', target: 30, description: 'Finish within 30 pieces' },
            ],
        },
        stars: { one: { combo: 3 }, two: { combo: 3, bonuses: 1 }, three: { combo: 3, bonuses: 2 } },
        mechanicFocus: 'chain',
    },
    // Keep the generous clock; pace 330 → 216 ms instead of 151 → 99. Star times ask 0.7 and 1.1 pieces/s; the
    // separate time bonus folds into them.
    15: {
        mechanics: { speed: { startLevel: 4, fixedDropInterval: 330, levelProgression: true } },
        victory: { bonuses: [] },
        stars: { one: { lines: 42 }, two: { lines: 42, time: 160 }, three: { lines: 42, time: 100 } },
    },
    // A real rest: 30 lines instead of 45, without the cliff (700 → 330 ms). Stars: 3 Quads, then also a fourth
    // Quad or no singles, the player's choice.
    16: {
        mechanics: { speed: { startLevel: 2, fixedDropInterval: 700, levelProgression: true } },
        victory: {
            primary: { type: 'lines', target: 30 },
            bonuses: [
                { type: 'quad-count', target: 4, description: 'Clear 4 Quads' },
                { type: 'no-singles', description: 'No single-line clears' },
            ],
        },
        stars: {
            one: { lines: 30 },
            two: { lines: 30, quads: 3 },
            three: { lines: 30, quads: 3, bonuses: 1 },
        },
    },
    // The boss tests what the chapter taught: score with the multiplier against the chapter's tightest clock
    // (30,000 in 300 s) over a cascade floor. Pass 2: a hybrid well paced like the chapter's test (350 ms,
    // speeding up with lines) instead of a calm 670 ms, so the boss is its chapter's peak, not its easiest orb.
    17: {
        victory: {
            primary: { type: 'score', target: 30000 },
            failure: { type: 'time', value: 300 },
            bonuses: [{ type: 'max-cascade-depth', target: 4, description: 'Trigger a 4-wave chain' }],
        },
        modifiers: { active: ['gravity-cascade', 'combo-multiplier', 'time-attack'] },
        stars: {
            one: { score: 30000 },
            two: { score: 30000, time: 180 },
            three: { score: 30000, time: 140, maxCascadeDepth: 4 },
        },
        mechanics: {
            baseMode: 'hybrid',
            speed: { startLevel: 4, fixedDropInterval: 350, levelProgression: true },
        },
        mechanicFocus: 'score',
    },
    // Keep.
    18: { role: 'rival' },
    // Arrival at 330 ms instead of 120. Three stars ask for 8 cascades instead of cascades and Quads in one run.
    19: {
        mechanics: { speed: { startLevel: 5, fixedDropInterval: 330, levelProgression: true } },
        victory: { bonuses: [{ type: 'cascade', target: 8, description: 'Trigger 8 cascades' }] },
        stars: {
            one: { score: 22000 },
            two: { score: 22000, cascades: 3 },
            three: { score: 22000, cascades: 8 },
        },
    },
    // Pass 2: digging comes back as practice (taught on orb 8): dig 8 of 10 rubble rows out of the ice at a steady
    // 300 ms, instead of a third score orb in a chapter that alternated score and cascades.
    21: {
        mechanics: {
            speed: { startLevel: 4, fixedDropInterval: 300, levelProgression: false },
            baseMode: 'standard',
            board: { columns: 10, rows: 20, startingRows: 10 },
        },
        victory: {
            bonuses: [],
            primary: { type: 'rubble', target: 8 },
            failure: { type: 'top-out', value: null },
        },
        stars: {
            one: { rubbleCleared: 8 },
            two: { rubbleCleared: 8, time: 50 },
            three: { rubbleCleared: 8, time: 35 },
        },
        modifiers: { active: [] },
        mechanicFocus: 'dig',
    },
    // No longer a flat repeat of orb 20: cascades over 5 rubble rows at 680 ms. Pass 2: the chapter's rest, 9
    // cascades instead of 11, with a 70-piece budget for the tidy-run star.
    22: {
        mechanics: { board: { startingRows: 5 }, speed: { fixedDropInterval: 680 } },
        victory: {
            primary: { type: 'cascade', target: 9 },
            bonuses: [
                { type: 'max-cascade-depth', target: 4, description: 'Trigger a 4-wave chain' },
                { type: 'pieces', target: 70, description: 'Finish within 70 pieces' },
            ],
        },
        stars: {
            one: { cascades: 9 },
            two: { cascades: 9, maxCascadeDepth: 3 },
            three: { cascades: 9, maxCascadeDepth: 3, bonuses: 1 },
        },
        role: 'release',
    },
    // Slower gravity (250 → 184 ms instead of 99 → 84) with a real clock: 34 lines in 200 s. Star times ask 0.8
    // and 1.17 pieces/s.
    23: {
        mechanics: { speed: { startLevel: 6, fixedDropInterval: 250, levelProgression: true } },
        victory: {
            primary: { type: 'lines', target: 34 },
            failure: { type: 'time', value: 200 },
            bonuses: [],
        },
        stars: { one: { lines: 34 }, two: { lines: 34, time: 110 }, three: { lines: 34, time: 75 } },
    },
    // Pass 2: the rising tide arrives gently, as chapter 4's twist on the coast where the land rises: clear 24
    // lines while rubble rows rise (the first at 15 s, every 12 s tightening to every 6 s over 4 minutes) at a
    // steady 500 ms.
    24: {
        mechanics: {
            speed: { startLevel: 2, fixedDropInterval: 500, levelProgression: false },
            baseMode: 'standard',
            board: { columns: 10, rows: 20, startingRows: 0 },
            tide: {
                startSeconds: 15,
                firstEverySeconds: 12,
                lastEverySeconds: 6,
                rampSeconds: 240,
            },
        },
        victory: {
            primary: { type: 'lines', target: 24 },
            bonuses: [],
            failure: { type: 'top-out', value: null },
        },
        stars: { one: { lines: 24 }, two: { lines: 24, time: 80 }, three: { lines: 24, time: 50 } },
        modifiers: { active: [] },
        role: 'twist',
    },
    // Keep the tall-well cascade boss. Drop the inert multiplier and the uncounted 6-wave bonus.
    25: { victory: { bonuses: [] }, modifiers: { active: ['gravity-cascade'] } },
    // Keep.
    26: { role: 'rival' },
    // Arrival at 260 ms instead of 84. Stars become reachable: 5 cascades, then 12, with no Quads in the same
    // tier.
    27: {
        mechanics: { speed: { startLevel: 7, fixedDropInterval: 260, levelProgression: true } },
        victory: { bonuses: [{ type: 'cascade', target: 12, description: 'Trigger 12 cascades' }] },
        stars: {
            one: { score: 34000 },
            two: { score: 34000, cascades: 5 },
            three: { score: 34000, cascades: 12 },
        },
    },
    // Remove the cliff (600 → 283 ms); 32 lines instead of 42.
    28: {
        mechanics: { speed: { startLevel: 2, fixedDropInterval: 600, levelProgression: true } },
        victory: { primary: { type: 'lines', target: 32 } },
        stars: {
            one: { lines: 32 },
            two: { lines: 32, time: 95 },
            three: { lines: 32, time: 75, bonuses: 1 },
        },
    },
    // Chapter 5's precision lesson: 5 Quads at a steady 280 ms, no multiplier. Two stars within 105 pieces; three
    // stars also within 95 s.
    29: {
        mechanics: { speed: { startLevel: 4, fixedDropInterval: 280, levelProgression: false } },
        victory: {
            primary: { type: 'quads', target: 5 },
            bonuses: [{ type: 'pieces', target: 105, description: 'Finish within 105 pieces' }],
        },
        modifiers: { active: [] },
        stars: {
            one: { quads: 5 },
            two: { quads: 5, bonuses: 1 },
            three: { quads: 5, bonuses: 1, time: 95 },
        },
        role: 'teach',
        mechanicFocus: 'quads',
    },
    // Drop the inert multiplier. The chain asks fit the chapter: 3 and 4 waves instead of 4 and 5. Three stars take
    // a 3-wave chain and either a 4-wave chain or the ten cascades within 70 pieces.
    30: {
        modifiers: { active: ['gravity-cascade'] },
        victory: {
            bonuses: [
                { type: 'max-cascade-depth', target: 4, description: 'Trigger a 4-wave chain' },
                { type: 'pieces', target: 70, description: 'Finish within 70 pieces' },
            ],
        },
        stars: {
            one: { cascades: 10 },
            two: { cascades: 10, maxCascadeDepth: 3 },
            three: { cascades: 10, maxCascadeDepth: 3, bonuses: 1 },
        },
    },
    // Pass 2: chapter 5 tests the Quads it teaches on orb 29: 4 Quads within 150 s at a steady 240 ms, instead of
    // the third lines-against-the-clock test.
    31: {
        mechanics: {
            speed: { startLevel: 6, fixedDropInterval: 240, levelProgression: false },
            baseMode: 'standard',
            board: { columns: 10, rows: 20, startingRows: 0 },
        },
        victory: {
            bonuses: [],
            primary: { type: 'quads', target: 4 },
            failure: { type: 'time', value: 150 },
        },
        stars: { one: { quads: 4 }, two: { quads: 4, time: 70 }, three: { quads: 4, time: 50 } },
        modifiers: { active: ['time-attack'] },
        mechanicFocus: 'quads',
    },
    // No longer a second boss in a row: a "wonder" showcase. 14 cascades at 580 ms; stars after the goal at 18,
    // then 22 cascades with a 4-wave chain.
    32: {
        mechanics: { board: { startingRows: 6 }, speed: { fixedDropInterval: 580 } },
        victory: { primary: { type: 'cascade', target: 14 }, bonuses: [] },
        modifiers: { active: ['gravity-cascade'] },
        stars: {
            one: { cascades: 14 },
            two: { cascades: 18 },
            three: { cascades: 22, maxCascadeDepth: 4 },
        },
        role: 'reinforce',
    },
    // Take the wall down to a peak: 55,000 in 250 s at 150 → 122 ms needs 0.64 pieces/s instead of 1.11. Three
    // stars: within 145 s and 12 cascades.
    33: {
        mechanics: { speed: { startLevel: 11, fixedDropInterval: 150, levelProgression: true } },
        victory: {
            primary: { type: 'score', target: 55000 },
            failure: { type: 'time', value: 250 },
            bonuses: [{ type: 'cascade', target: 12, description: 'Trigger 12 cascades' }],
        },
        stars: {
            one: { score: 55000 },
            two: { score: 55000, time: 180 },
            three: { score: 55000, time: 145, bonuses: 1 },
        },
    },
    // Capped at 270 actions a minute (tier 5 plays at 320).
    34: {
        mechanics: { versus: { botOverrides: { maxApm: 270, reactionMs: [200, 380] } } },
        role: 'rival',
    },
    // Pace 240 → 134 ms instead of 151 → 84. Stars become reachable: 3 Quads, then 5, with no chain in the same
    // tier.
    35: {
        mechanics: { speed: { startLevel: 4, fixedDropInterval: 240, levelProgression: true } },
        victory: { bonuses: [{ type: 'quad-count', target: 5, description: 'Clear 5 Quads' }] },
        stars: {
            one: { score: 28000 },
            two: { score: 28000, quads: 3 },
            three: { score: 28000, quads: 5 },
        },
    },
    // Keep; retag it, and drop the inert multiplier and the uncounted bonus.
    36: { victory: { bonuses: [] }, modifiers: { active: ['gravity-cascade'] }, role: 'reinforce' },
    // Pace 220 → 162 ms instead of 99 → 73. Star times are real: 1.0 and 1.4 pieces/s instead of 0.35 and 0.46.
    37: {
        mechanics: { speed: { startLevel: 6, fixedDropInterval: 220, levelProgression: true } },
        victory: { bonuses: [] },
        stars: { one: { lines: 36 }, two: { lines: 36, time: 85 }, three: { lines: 36, time: 60 } },
    },
    // Pass 2: the blood moon pulls the tide: clear 36 lines while rubble rows rise (the first at 6 s, every 6 s
    // tightening to every 3 s over 150 s) at a steady 190 ms, instead of the third score race in a cascade well.
    38: {
        mechanics: {
            speed: { startLevel: 8, fixedDropInterval: 190, levelProgression: false },
            baseMode: 'standard',
            board: { columns: 10, rows: 20, startingRows: 0 },
            tide: {
                startSeconds: 6,
                firstEverySeconds: 6,
                lastEverySeconds: 3,
                rampSeconds: 150,
            },
        },
        victory: {
            primary: { type: 'lines', target: 36 },
            failure: { type: 'top-out', value: null },
            bonuses: [],
        },
        stars: { one: { lines: 36 }, two: { lines: 36, time: 80 }, three: { lines: 36, time: 60 } },
        modifiers: { active: [] },
    },
    // Phase 3's survival goal ("keep the ember alive"): last 90 seconds from 170 ms while the pieces fall twice as
    // fast every 2:30, then play on; two stars at 3 minutes, three at 5. A twist between the arc's two tests
    // instead of a 70,000-point grind at 65 → 44 ms.
    39: {
        victoryLapPolicy: 'showcase',
        mechanics: {
            speed: {
                startLevel: 9,
                fixedDropInterval: 170,
                levelProgression: false,
                doublingSeconds: 150,
            },
        },
        modifiers: { active: [] },
        victory: {
            primary: { type: 'time', target: 90 },
            failure: { type: 'top-out', value: null },
            bonuses: [],
        },
        stars: { one: { survived: 90 }, two: { survived: 180 }, three: { survived: 300 } },
        role: 'twist',
    },
    // Pass 2: lines against the clock in a cascade well (40 lines in 180 s, 30 rows over 6 rubble rows, 190 ms),
    // so cascades pay under time pressure, instead of the fourth plain lines-against-the-clock test.
    40: {
        mechanics: {
            speed: { startLevel: 8, fixedDropInterval: 190, levelProgression: false },
            baseMode: 'hybrid',
            board: { columns: 10, rows: 30, startingRows: 6 },
        },
        victory: {
            primary: { type: 'lines', target: 40 },
            failure: { type: 'time', value: 180 },
            bonuses: [],
        },
        stars: { one: { lines: 40 }, two: { lines: 40, time: 90 }, three: { lines: 40, time: 65 } },
        modifiers: { active: ['gravity-cascade', 'time-attack'] },
    },
    // The rest after the tests: 40,000 at 200 → 140 ms instead of 54,000 at 73 → 48. Star times are real; three
    // stars add 6 Quads.
    41: {
        mechanics: { speed: { startLevel: 8, fixedDropInterval: 200, levelProgression: true } },
        victory: {
            primary: { type: 'score', target: 40000 },
            bonuses: [{ type: 'quad-count', target: 6, description: 'Clear 6 Quads' }],
        },
        stars: {
            one: { score: 40000 },
            two: { score: 40000, time: 155 },
            three: { score: 40000, time: 130, bonuses: 1 },
        },
        role: 'release',
    },
    // Pass 2: the digging test: dig 11 of 12 rubble rows out of the dunes at a steady 180 ms in a 24-row well,
    // instead of the chapter's third lines orb.
    42: {
        mechanics: {
            speed: { startLevel: 8, fixedDropInterval: 180, levelProgression: false },
            baseMode: 'hybrid',
            board: { columns: 10, rows: 24, startingRows: 12 },
        },
        victory: {
            primary: { type: 'rubble', target: 11 },
            bonuses: [],
            failure: { type: 'top-out', value: null },
        },
        stars: {
            one: { rubbleCleared: 11 },
            two: { rubbleCleared: 11, time: 90 },
            three: { rubbleCleared: 11, time: 65 },
        },
        modifiers: { active: [] },
        mechanicFocus: 'dig',
    },
    // Pass 2 (D9): the chain comes back as practice: trigger a 4-wave chain within 150 s in a deep rubble well (32
    // rows, 10 rubble rows, 600 ms), instead of a second score rest.
    43: {
        mechanics: {
            speed: { startLevel: 4, fixedDropInterval: 600, levelProgression: false },
            baseMode: 'infinity',
            board: { columns: 10, rows: 32, startingRows: 10 },
        },
        modifiers: { active: ['gravity-cascade', 'time-attack'] },
        victory: {
            primary: { type: 'combo', target: 4 },
            bonuses: [
                { type: 'pieces', target: 60, description: 'Finish within 60 pieces' },
                { type: 'pieces', target: 40, description: 'Finish within 40 pieces' },
            ],
            failure: { type: 'time', value: 150 },
        },
        stars: { one: { combo: 4 }, two: { combo: 4, bonuses: 1 }, three: { combo: 4, bonuses: 2 } },
        role: 'reinforce',
        mechanicFocus: 'chain',
    },
    // No longer a duplicate of orb 43: a Quad practice, 6 Quads at a steady 260 ms. Two stars within 120 pieces;
    // three also within 100 s.
    44: {
        mechanics: { speed: { startLevel: 5, fixedDropInterval: 260, levelProgression: false } },
        victory: {
            primary: { type: 'quads', target: 6 },
            bonuses: [{ type: 'pieces', target: 120, description: 'Finish within 120 pieces' }],
        },
        modifiers: { active: [] },
        stars: {
            one: { quads: 6 },
            two: { quads: 6, bonuses: 1 },
            three: { quads: 6, bonuses: 1, time: 100 },
        },
        role: 'reinforce',
        mechanicFocus: 'quads',
    },
    // The wall becomes the second arc's test: 68,000 in 240 s at 145 → 115 ms (0.75 pieces/s instead of 1.25).
    // Three stars: within 150 s and 15 cascades.
    45: {
        mechanics: { speed: { startLevel: 13, fixedDropInterval: 145, levelProgression: true } },
        victory: {
            primary: { type: 'score', target: 68000 },
            failure: { type: 'time', value: 240 },
            bonuses: [{ type: 'cascade', target: 15, description: 'Trigger 15 cascades' }],
        },
        stars: {
            one: { score: 68000 },
            two: { score: 68000, time: 180 },
            three: { score: 68000, time: 150, bonuses: 1 },
        },
        role: 'test',
    },
    // A real rest: 32 lines at 260 → 207 ms instead of 42 at 73 → 58.
    46: {
        mechanics: { speed: { startLevel: 8, fixedDropInterval: 260, levelProgression: true } },
        victory: { primary: { type: 'lines', target: 32 } },
        stars: {
            one: { lines: 32 },
            two: { lines: 32, time: 85 },
            three: { lines: 32, time: 70, bonuses: 1 },
        },
    },
    // The black hole stays the chapter's signature: 20 cascades instead of 25. Pass 2: a steady 340 ms instead of
    // 520 brings it within 0.3 of its chapter's test on the index; stars after the goal at 26 cascades with a
    // 4-wave chain, then 32 with a 5-wave chain.
    47: {
        mechanics: { speed: { fixedDropInterval: 340 } },
        victory: { primary: { type: 'cascade', target: 20 }, bonuses: [] },
        modifiers: { active: ['gravity-cascade'] },
        stars: {
            one: { cascades: 20 },
            two: { cascades: 26, maxCascadeDepth: 4 },
            three: { cascades: 32, maxCascadeDepth: 5 },
        },
    },
    // Capped at 300 actions a minute (tier 6 plays at 460).
    48: {
        mechanics: { versus: { botOverrides: { maxApm: 300, reactionMs: [180, 340] } } },
        role: 'rival',
    },
    // Arrival at 200 ms instead of 84. Stars become reachable: 4 Quads, then 6 (no policy reached the shipped 8).
    49: {
        mechanics: { speed: { startLevel: 7, fixedDropInterval: 200, levelProgression: true } },
        victory: { bonuses: [{ type: 'quad-count', target: 6, description: 'Clear 6 Quads' }] },
        stars: {
            one: { score: 36000 },
            two: { score: 36000, quads: 4 },
            three: { score: 36000, quads: 6 },
        },
    },
    // Pass 2: the sprint moves here from orb 51 (50 lines in 180 s, 120 → 105 ms, still the campaign's fastest),
    // so chapter 7 opens on its hardest test and the mirrored twist follows; replaces the fifth score race in a
    // cascade well.
    50: {
        mechanics: {
            speed: { startLevel: 13, fixedDropInterval: 120, levelProgression: true },
            baseMode: 'standard',
            board: { columns: 10, rows: 20, startingRows: 0 },
        },
        victory: {
            primary: { type: 'lines', target: 50 },
            failure: { type: 'time', value: 180 },
            bonuses: [],
        },
        stars: { one: { lines: 50 }, two: { lines: 50, time: 125 }, three: { lines: 50, time: 90 } },
        modifiers: { active: ['time-attack'] },
        role: 'test',
    },
    // Pass 2 (D10): a twist that changes the rules: 30 lines with mirrored controls at a steady 240 ms, so
    // mirroring is chapter 7's "other dimension" with orb 53. The sprint moved to orb 50.
    51: {
        mechanics: {
            speed: { startLevel: 6, fixedDropInterval: 240, levelProgression: false },
            baseMode: 'standard',
            board: { columns: 10, rows: 20, startingRows: 0 },
        },
        victory: {
            primary: { type: 'lines', target: 30 },
            failure: { type: 'top-out', value: null },
            bonuses: [],
        },
        stars: { one: { lines: 30 }, two: { lines: 30, time: 80 }, three: { lines: 30, time: 55 } },
        modifiers: { active: ['mirror'] },
        role: 'twist',
    },
    // Pass 2 (D9): the chain test: trigger a 4-wave chain within 240 s from a one-row floor (27 rows, 550 ms),
    // instead of a cascade count whose chains were only star asks. An empty floor made the chain a matter of luck
    // (24 or 300 pieces).
    52: {
        victory: {
            primary: { type: 'combo', target: 4 },
            bonuses: [
                { type: 'pieces', target: 140, description: 'Finish within 140 pieces' },
                { type: 'pieces', target: 100, description: 'Finish within 100 pieces' },
            ],
            failure: { type: 'time', value: 240 },
        },
        modifiers: { active: ['gravity-cascade', 'time-attack'] },
        stars: { one: { combo: 4 }, two: { combo: 4, bonuses: 1 }, three: { combo: 4, bonuses: 2 } },
        mechanics: {
            baseMode: 'infinity',
            board: { columns: 10, rows: 27, startingRows: 1 },
            speed: { startLevel: 4, fixedDropInterval: 550, levelProgression: false },
        },
        role: 'test',
        mechanicFocus: 'chain',
    },
    // Chapter 7 is "another dimension": mirrored controls on a slow, short orb (24 lines, 500 ms, 3 rubble rows
    // instead of 36 lines and 6).
    53: {
        mechanics: { board: { startingRows: 3 } },
        modifiers: { active: ['gravity-cascade', 'mirror'] },
        victory: { primary: { type: 'lines', target: 24 }, bonuses: [] },
        stars: { one: { lines: 24 }, two: { lines: 24, time: 55 }, three: { lines: 24, time: 40 } },
    },
    // Keep the rehearsal for orb 55; retag it.
    54: { role: 'reinforce' },
    // The capstone stays the longest orb but becomes possible: 160,000 in 600 s (0.70 pieces/s instead of 0.98).
    // Pass 2: a steady 340 ms instead of 500, so the ten-minute final exam asks more of a casual player.
    55: {
        victory: {
            primary: { type: 'score', target: 160000 },
            failure: { type: 'time', value: 600 },
            bonuses: [
                { type: 'max-cascade-depth', target: 5, description: 'Trigger a 5-wave chain' },
                { type: 'cascade', target: 26, description: 'Trigger 26 cascades' },
            ],
        },
        stars: {
            one: { score: 160000 },
            two: { score: 210000, cascades: 20 },
            three: { score: 270000, cascades: 26, maxCascadeDepth: 5 },
        },
        mechanics: { speed: { fixedDropInterval: 340 } },
    },
    // Tier 6 instead of 7 (D8): tier 7 looks two pieces ahead, which made Prism as hard as the last rival for a
    // person. Capped at 330 actions a minute (tier 6 plays at 460).
    56: {
        mechanics: { versus: { botOverrides: { maxApm: 330, reactionMs: [160, 320] }, botDifficulty: 6 } },
        role: 'rival',
    },
    // Pace 180 → 126 ms instead of 120 → 84. Real star times; three stars add 4 Quads.
    57: {
        mechanics: { speed: { startLevel: 5, fixedDropInterval: 180, levelProgression: true } },
        victory: { bonuses: [{ type: 'quad-count', target: 4, description: 'Clear 4 Quads' }] },
        stars: {
            one: { lines: 30 },
            two: { lines: 30, time: 75 },
            three: { lines: 30, time: 65, bonuses: 1 },
        },
        role: 'arrival',
    },
    // The encore's twist: survive the rising tide (rubble rows rise from below, faster over time) for a minute at
    // a steady 160 ms, then play on; two stars at 2 minutes, three at 3. Replaces a score orb with the multiplier.
    58: {
        victoryLapPolicy: 'showcase',
        mechanics: {
            speed: { startLevel: 6, fixedDropInterval: 160, levelProgression: false },
            tide: {
                startSeconds: 8,
                firstEverySeconds: 6,
                lastEverySeconds: 2,
                rampSeconds: 180,
            },
        },
        modifiers: { active: [] },
        victory: {
            primary: { type: 'time', target: 60 },
            failure: { type: 'top-out', value: null },
            bonuses: [],
        },
        stars: { one: { survived: 60 }, two: { survived: 120 }, three: { survived: 180 } },
        role: 'twist',
    },
    // Pass 2 (D11): the encore boss scores under the rising tide its chapter just taught (the first row at 12 s,
    // every 9 s tightening to every 3 s over 4 minutes) instead of racing a clock; the showcase lap ends when the
    // tide wins. Stars after the goal: 115,000 with 14 cascades, then 140,000 with 18 and a 5-wave chain.
    59: {
        mechanics: {
            speed: { startLevel: 11, fixedDropInterval: 150, levelProgression: true },
            tide: {
                startSeconds: 12,
                firstEverySeconds: 9,
                lastEverySeconds: 3,
                rampSeconds: 240,
            },
        },
        victory: {
            primary: { type: 'score', target: 70000 },
            failure: { type: 'top-out', value: null },
            bonuses: [
                { type: 'cascade', target: 18, description: 'Trigger 18 cascades' },
                { type: 'max-cascade-depth', target: 5, description: 'Trigger a 5-wave chain' },
            ],
        },
        stars: {
            one: { score: 70000 },
            two: { score: 115000, cascades: 14 },
            three: { score: 140000, cascades: 18, maxCascadeDepth: 5 },
        },
        modifiers: { active: ['gravity-cascade', 'combo-multiplier'] },
        role: 'boss',
    },
    // The last rival stays the strongest but becomes beatable: capped at 340 actions a minute (tier 8 plays at
    // 900).
    60: {
        mechanics: { versus: { botOverrides: { maxApm: 340, reactionMs: [150, 300] } } },
        role: 'rival',
    },
});

function mergeRetune(base, override) {
    const merged = { ...base };
    for (const [key, value] of Object.entries(override)) {
        const baseValue = base?.[key];
        if (REPLACE_KEYS.has(key) || !value || typeof value !== 'object' || Array.isArray(value)
            || !baseValue || typeof baseValue !== 'object' || Array.isArray(baseValue)) {
            merged[key] = structuredClone(value);
        } else {
            merged[key] = mergeRetune(baseValue, value);
        }
    }
    return merged;
}

// R9: every solo well draws a three-piece preview, so its data says three (the authored 3-6 was never read).
function withThreePreviews(level) {
    if (level.mechanics?.versus || level.mechanics?.pieces?.previewCount === 3) return level;
    return { ...level, mechanics: { ...level.mechanics, pieces: { ...level.mechanics.pieces, previewCount: 3 } } };
}

// A rival's subtitle names its tier, so it follows the retuned tier (D8: rival 56 plays at tier 6).
function withRivalSubtitle(level) {
    const versus = level.mechanics?.versus;
    if (!versus) return level;
    const subtitle = formatOdysseyRival(versus.botName, versus.botDifficulty);
    if (level.metadata?.subtitle === subtitle) return level;
    return { ...level, metadata: { ...level.metadata, subtitle } };
}

/** The assembled campaign with the retune applied; orbs without an entry keep their rules. */
export function applyOdysseyLevelDesign(levels) {
    return levels.map((level) => {
        const retune = ODYSSEY_LEVEL_DESIGN_2026_11[level.id];
        return withRivalSubtitle(withThreePreviews(retune ? mergeRetune(level, retune) : level));
    });
}

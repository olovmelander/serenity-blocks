import { describe, expect, it } from 'vitest';
import { getBotDifficultyConfig } from '../../src/core/ai/bot-difficulty.js';
import { LEVEL_SPEEDS } from '../../src/core/constants.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';

/**
 * The level design rules R1-R9 (docs/ODYSSEY_LEVEL_DESIGN_AUDIT_2026-11.md §5.1), asserted on the campaign as
 * players meet it, so a later tweak cannot quietly break the curve.
 *
 * MEASURED is what a regular player needs for one star, from the audit's benchmark on seeds 12001-12005:
 * [pieces placed, lines cleared] at the goal by the regular proxy (Quad goals: the Quad proxy; cascade and chain
 * goals: the cascade proxy). It is the yardstick for clocks, star times, lengths and the speed reached before one
 * star. When an orb's goal, well or speed changes, re-measure it (npm run benchmark:odyssey) and update its row.
 */
const MEASURED = Object.freeze({
    1: [54, 20],
    2: [32, 36],
    3: [29, 81],
    4: [75, 30],
    6: [45, 20],
    7: [49, 88],
    8: [31, 16],
    9: [61, 102],
    11: [69, 26],
    12: [52, 284],
    13: [92, 34],
    14: [30, 162],
    15: [111, 42],
    16: [82, 30],
    17: [129, 54],
    19: [98, 39],
    20: [66, 83],
    21: [111, 43],
    22: [92, 178],
    23: [88, 34],
    24: [101, 39],
    25: [126, 199],
    27: [138, 54],
    28: [85, 32],
    29: [103, 522],
    30: [77, 123],
    31: [96, 37],
    32: [109, 181],
    33: [160, 67],
    35: [136, 52],
    36: [95, 148],
    37: [84, 36],
    38: [157, 66],
    39: [112, 43],
    40: [115, 45],
    41: [154, 60],
    42: [115, 45],
    43: [135, 54],
    44: [118, 438],
    45: [181, 76],
    46: [85, 32],
    47: [129, 233],
    49: [147, 57],
    50: [181, 73],
    51: [130, 50],
    52: [86, 172],
    53: [58, 24],
    54: [84, 103],
    55: [419, 189],
    57: [82, 30],
    58: [76, 31],
    59: [211, 86],
});

// R1, by chapter: [slowest start, fastest start, floor before one star, arrival starts no faster than] (ms/row).
const SPEED = Object.freeze({
    1: [720, 420, 240, 720],
    2: [800, 450, 250, 800],
    3: [700, 330, 200, 450],
    4: [650, 250, 170, 330],
    5: [600, 150, 125, 260],
    6: [260, 140, 115, 240],
    7: [260, 120, 105, 200],
    8: [190, 140, 105, 180],
});
// R2: one-star clock pace cap (pieces/s); chapters 1-2 have no clocks and use 0.40 as their star-time base.
const PACE_CAP = Object.freeze({
    1: 0.40, 2: 0.40, 3: 0.45, 4: 0.55, 5: 0.65, 6: 0.75, 7: 0.80, 8: 0.85,
});
// R5: chain waves two stars may ask, cascade-goal size, and Quads asked outside Quad goals.
const CHAIN_TWO_STARS = Object.freeze({
    1: 3, 2: 3, 3: 4, 4: 4, 5: 4, 6: 5, 7: 5, 8: 5,
});
const CASCADE_GOAL = Object.freeze({
    1: 4, 2: 8, 3: 13, 4: 16, 5: 16, 6: 20, 7: 20, 8: 20,
});
const QUAD_ASK = Object.freeze({
    1: 2, 2: 2, 3: 4, 4: 4, 5: 6, 6: 6, 7: 6, 8: 6,
});

const ROLES = new Set(['arrival', 'teach', 'reinforce', 'twist', 'release', 'test', 'boss', 'rival']);
const PEAKS = new Set(['test', 'boss', 'rival']);
const GENTLE = new Set(['arrival', 'teach', 'twist', 'release']);
// 39 and 58 are survival orbs (phase 3; 58 under the rising tide): their lap is the survival beyond the goal,
// where the extra stars are.
const SHOWCASES = [32, 39, 47, 55, 58, 59];
// Phase 3: a rubble goal's stars count rows dug out; a survival goal's count seconds survived (a lower bound).
const PRIMARY_METRIC = Object.freeze({ cascade: 'cascades', rubble: 'rubbleCleared', time: 'survived' });
const CHAIN_KEYS = ['maxCascadeDepth', 'combo'];

const solo = LEVEL_CONFIGS.filter((level) => !level.mechanics.versus);
const duels = LEVEL_CONFIGS.filter((level) => level.mechanics.versus);
const isShowcase = (level) => level.victoryLapPolicy === 'showcase';
const chainOf = (condition) => Math.max(...CHAIN_KEYS.map((key) => Number(condition?.[key]) || 0));
const metricOf = (level) => PRIMARY_METRIC[level.victory.primary.type] || level.victory.primary.type;

function opening(level) {
    const { speed } = level.mechanics;
    return speed.fixedDropInterval || LEVEL_SPEEDS[speed.startLevel - 1];
}

/** The fastest fall on the way to one star: the proportional curve after the measured lines. */
function fastestBeforeOneStar(level) {
    const { speed } = level.mechanics;
    // A survival ramp (phase 3) halves the drop every doublingSeconds; at the goal it is the fastest before one star.
    if (speed.doublingSeconds > 0) {
        return opening(level) * 0.5 ** (level.victory.primary.target / speed.doublingSeconds);
    }
    if (!speed.levelProgression) return opening(level);
    const reached = Math.min(speed.startLevel + Math.floor(MEASURED[level.id][1] / 15), LEVEL_SPEEDS.length);
    return LEVEL_SPEEDS[reached - 1] * (opening(level) / LEVEL_SPEEDS[speed.startLevel - 1]);
}

describe('Odyssey campaign design rules (level design audit 2026-11)', () => {
    it('measures every solo orb', () => {
        expect(Object.keys(MEASURED).map(Number)).toEqual(solo.map((level) => level.id));
    });

    it('R1: keeps each chapter inside its speed band, above its floor, and on the proportional curve', () => {
        for (const level of solo.filter((entry) => entry.mechanics.baseMode !== 'infinity')) {
            const [slowest, fastest, floor, arrival] = SPEED[level.chapter];
            const { speed } = level.mechanics;
            const start = opening(level);
            expect(start, `orb ${level.id} starts no faster than its chapter`).toBeGreaterThanOrEqual(fastest);
            if (!['release', 'twist'].includes(level.role)) {
                expect(start, `orb ${level.id} starts no slower than its chapter`).toBeLessThanOrEqual(slowest);
            }
            if (level.role === 'arrival') expect(start, `orb ${level.id} arrival`).toBeGreaterThanOrEqual(arrival);
            const grace = level.role === 'boss' || isShowcase(level) ? 0.95 : 1;
            // Speeds are whole milliseconds in the audit, so the floor holds to the nearest half millisecond.
            expect(fastestBeforeOneStar(level), `orb ${level.id} floor`).toBeGreaterThanOrEqual(floor * grace - 0.5);
            if (speed.levelProgression) {
                expect(speed.fixedDropInterval, `orb ${level.id} authors its opening`).toBeGreaterThan(0);
                expect(speed.startLevel, `orb ${level.id} skips the 720 -> 320 cliff`).toBeGreaterThanOrEqual(2);
            }
        }
    });

    it('R2: caps the one-star clock pace and sets star times from one ladder', () => {
        const timed = solo.filter((level) => level.victory.failure.type === 'time');
        expect(MEASURED[timed[0].id][0] / timed[0].victory.failure.value).toBeLessThanOrEqual(0.45);
        for (const level of timed) {
            const pace = MEASURED[level.id][0] / level.victory.failure.value;
            expect(pace, `orb ${level.id} one-star pace`).toBeLessThanOrEqual(PACE_CAP[level.chapter] + 0.005);
        }
        for (const level of solo) {
            const pieces = MEASURED[level.id][0];
            const base = PACE_CAP[level.chapter];
            const { two, three } = level.stars;
            // A star time is the measured pieces at the ladder's pace, rounded to 5 s (or tighter under a clock).
            const ladderTime = (pace) => 5 * Math.round(pieces / pace / 5);
            if (Number.isFinite(two.time)) {
                expect(two.time, `orb ${level.id} two-star time`).toBeLessThanOrEqual(ladderTime(base + 0.25));
            }
            if (Number.isFinite(three.time)) {
                const build = Object.keys(three).some((key) => key !== metricOf(level) && key !== 'time');
                expect(three.time, `orb ${level.id} three-star time`)
                    .toBeLessThanOrEqual(ladderTime(build ? base + 0.45 : Math.max(base + 0.65, 1.10)));
                if (Number.isFinite(two.time)) expect(three.time).toBeLessThan(two.time);
            }
        }
    });

    it('R3: introduces each goal type and modifier on a gentle orb, never a test, boss or rival', () => {
        const seen = new Set();
        for (const level of LEVEL_CONFIGS) {
            const ideas = [`goal:${level.victory.primary.type}`,
                ...level.modifiers.active.filter((id) => id !== 'time-attack').map((id) => `mod:${id}`)];
            for (const idea of ideas) {
                if (seen.has(idea) || idea === 'goal:frags') continue;
                seen.add(idea);
                expect(GENTLE.has(level.role), `${idea} first appears on orb ${level.id} (${level.role})`).toBe(true);
            }
        }
    });

    it('R4: one star is the goal, every tier asks more, and no tier mixes Quads with chains', () => {
        for (const level of LEVEL_CONFIGS) {
            const { one, two, three } = level.stars;
            const { target } = level.victory.primary;
            expect(one, `orb ${level.id} one star is the goal`).toEqual({ [metricOf(level)]: target });
            expect(two, `orb ${level.id} two stars ask more than one`).not.toEqual(one);
            expect(three, `orb ${level.id} three stars ask more than two`).not.toEqual(two);
            if (level.mechanics.versus) continue;
            for (const condition of [two, three]) {
                const quads = Number(condition.tetrises) > 0;
                const cascadeAsk = Number(condition.cascades) > 0 && metricOf(level) !== 'cascades';
                const chains = chainOf(condition) > 0 || cascadeAsk;
                if (!['cascade', 'combo'].includes(level.victory.primary.type)) {
                    expect(quads && chains, `orb ${level.id} mixes Quads with chains`).toBe(false);
                }
            }
            const types = new Set(level.victory.bonuses.map((bonus) => bonus.type));
            const chainBonus = ['max-cascade-depth', 'combo', 'cascade'].some((type) => types.has(type));
            expect(types.has('tetris-count') && chainBonus, `orb ${level.id} extra goals mix Quads with chains`)
                .toBe(false);
        }
        expect(LEVEL_CONFIGS.filter(isShowcase).map((level) => level.id)).toEqual(SHOWCASES);
    });

    it('R4: counts every listed extra goal toward a star', () => {
        for (const level of solo) {
            const tiers = Object.values(level.stars);
            const byBonuses = tiers.some((condition) => Number(condition.bonuses) > 0);
            for (const bonus of level.victory.bonuses) {
                const matched = byBonuses || tiers.some((condition) => (
                    (bonus.type === 'tetris-count' && condition.tetrises >= bonus.target)
                    || (bonus.type === 'cascade' && condition.cascades >= bonus.target)
                    || (['max-cascade-depth', 'combo'].includes(bonus.type) && chainOf(condition) >= bonus.target)
                    || (bonus.type === 'time' && condition.time <= bonus.target)
                ));
                expect(matched, `orb ${level.id} counts its ${bonus.type} extra goal`).toBe(true);
            }
        }
    });

    it('R5: asks for chains, cascades and Quads on the construction ladder', () => {
        for (const level of solo) {
            const showcase = isShowcase(level) ? 1 : 0;
            const { two, three } = level.stars;
            expect(chainOf(two), `orb ${level.id} two-star chain`)
                .toBeLessThanOrEqual(CHAIN_TWO_STARS[level.chapter] + showcase);
            expect(chainOf(three), `orb ${level.id} three-star chain`)
                .toBeLessThanOrEqual(CHAIN_TWO_STARS[level.chapter] + 1 + showcase);
            const chainBonuses = level.victory.bonuses
                .filter((entry) => ['max-cascade-depth', 'combo'].includes(entry.type));
            for (const bonus of chainBonuses) {
                expect(bonus.target, `orb ${level.id} chain extra goal`)
                    .toBeLessThanOrEqual(CHAIN_TWO_STARS[level.chapter] + 1 + showcase);
            }
            if (level.victory.primary.type === 'cascade') {
                expect(level.victory.primary.target, `orb ${level.id} cascade goal`)
                    .toBeLessThanOrEqual(CASCADE_GOAL[level.chapter]);
            }
            if (level.victory.primary.type !== 'tetrises') {
                const quadAsks = [two.tetrises, three.tetrises,
                    ...level.victory.bonuses.filter((bonus) => bonus.type === 'tetris-count')
                        .map((bonus) => bonus.target)];
                for (const asked of quadAsks.filter(Number.isFinite)) {
                    expect(asked, `orb ${level.id} Quad ask`).toBeLessThanOrEqual(QUAD_ASK[level.chapter]);
                }
            }
        }
    });

    it('R6: keeps every orb inside its length budget', () => {
        for (const level of solo) {
            const pieces = MEASURED[level.id][0];
            const most = level.id === 55 ? 420 : 260;
            expect(pieces, `orb ${level.id} length`).toBeGreaterThanOrEqual(25);
            expect(pieces, `orb ${level.id} length`).toBeLessThanOrEqual(most);
            if (['arrival', 'release'].includes(level.role)) expect(pieces, `orb ${level.id}`).toBeLessThanOrEqual(160);
            if (['test', 'boss'].includes(level.role)) expect(pieces, `orb ${level.id}`).toBeGreaterThanOrEqual(60);
        }
    });

    it('R7: paces each chapter with rests and never three peaks in a row', () => {
        for (const chapter of CHAPTER_CONFIGS) {
            const roles = LEVEL_CONFIGS.filter((level) => level.chapter === chapter.id).map((level) => level.role);
            roles.forEach((role) => expect(ROLES.has(role), `chapter ${chapter.id}: ${role}`).toBe(true));
            expect(roles.at(-1), `chapter ${chapter.id} ends on its rival`).toBe('rival');
            for (let index = 0; index + 2 < roles.length; index++) {
                const run = roles.slice(index, index + 3);
                expect(run.every((role) => PEAKS.has(role)), `chapter ${chapter.id}: ${run.join(', ')}`).toBe(false);
            }
            if (chapter.id >= 3 && chapter.id <= 7) expect(roles, `chapter ${chapter.id} rest`).toContain('release');
        }
    });

    it('R8: makes each rival at least as smart as the last and faster, but never faster than a strong person', () => {
        let previousApm = 0;
        let previousTier = 0;
        for (const level of duels) {
            const { botDifficulty, botOverrides } = level.mechanics.versus;
            const tier = getBotDifficultyConfig(botDifficulty);
            expect(level.role).toBe('rival');
            // D8: a rival may share the last one's tier (Prism, 56, plays at Nova's tier 6) but never drop below it.
            expect(botDifficulty, `orb ${level.id} tier`).toBeGreaterThanOrEqual(previousTier);
            previousTier = botDifficulty;
            if (botDifficulty <= 4) {
                expect(botOverrides, `tier ${botDifficulty} plays at its own pace`).toBeUndefined();
                previousApm = tier.maxApm;
                continue;
            }
            expect(botOverrides.maxApm).toBeGreaterThan(previousApm);
            expect(botOverrides.maxApm).toBeLessThan(tier.maxApm);
            expect(botOverrides.maxApm).toBeLessThanOrEqual(360);
            expect(botOverrides.reactionMs[0]).toBeGreaterThanOrEqual(140);
            previousApm = botOverrides.maxApm;
        }
    });

    it('R9: gives every field a meaning', () => {
        for (const level of solo) {
            if (level.modifiers.active.includes('combo-multiplier')) {
                expect(level.victory.primary.type, `orb ${level.id} multiplier needs a score goal`).toBe('score');
            }
            expect(level.mechanics.pieces.previewCount, `orb ${level.id} previews`).toBe(3);
        }
    });
});

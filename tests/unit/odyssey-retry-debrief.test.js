import { describe, expect, it } from 'vitest';
import { LEVEL_CONFIGS, getLevelById } from '../../src/core/odyssey/data/levels.js';
import { VictoryConditionEvaluator } from '../../src/core/odyssey/VictoryConditionEvaluator.js';
import { getOdysseyRetryDebrief } from '../../src/ui/odyssey/objective-copy.js';

function soloLevel(type, target, active = []) {
    return {
        victory: { primary: { type, target } },
        modifiers: { active },
    };
}

describe('Odyssey retry debrief', () => {
    it('covers every authored solo objective while leaving all eight duels to their match summary', () => {
        const metrics = new VictoryConditionEvaluator().getMetrics();
        const solos = LEVEL_CONFIGS.filter((level) => !level.mechanics.versus);
        const duels = LEVEL_CONFIGS.filter((level) => level.mechanics.versus);
        expect(solos).toHaveLength(51);
        expect(duels).toHaveLength(8);

        for (const level of solos) {
            const debrief = getOdysseyRetryDebrief(level, metrics, 'top-out');
            expect(debrief, `orb ${level.id}`).not.toBeNull();
            expect(debrief.value).toBe(0);
            expect(debrief.target).toBe(level.victory.primary.target);
            expect(debrief.objective).toBeTruthy();
            expect(debrief.progressLabel).not.toMatch(/undefined|NaN|Infinity/);
            expect(debrief.remainingText).not.toMatch(/undefined|NaN|Infinity/);
            expect(debrief.tip).toBeTruthy();
        }
        for (const level of duels) {
            expect(getOdysseyRetryDebrief(level, { ...metrics, frags: 6 }, 'bot')).toBeNull();
        }
    });

    it.each([
        [getLevelById(51), { lines: 65 }, '1 line short of the goal.'],
        [getLevelById(49), { score: 35999 }, '1 point short of the goal.'],
        [getLevelById(2), { cascades: 2 }, '1 cascade sequence short of the goal.'],
        [soloLevel('time', 60), { time: 59.9 }, '1 second short of the goal.'],
    ])('reports a one-unit shortfall without rounding it into completion', (level, metrics, expected) => {
        const debrief = getOdysseyRetryDebrief(level, metrics, 'top-out');
        expect(debrief.remainingText).toBe(expected);
        expect(debrief.value).toBeLessThan(debrief.target);
        expect(debrief.tip).toContain('Make room at the top');
    });

    it('distinguishes separate cascade sequences from the best single-piece chain', () => {
        const evaluator = new VictoryConditionEvaluator();
        // Three pieces create chains of four, two and three waves. There are six
        // combo callbacks, but neither objective should present that event count.
        for (const waves of [[2, 3, 4], [2], [2, 3]]) {
            for (const wave of waves) {
                evaluator.onCascade(wave, wave === 2);
                evaluator.onCombo(wave);
            }
        }
        const metrics = evaluator.getMetrics();
        expect(metrics).toMatchObject({ cascades: 3, maxCombo: 4, combos: 6 });

        const sequences = getOdysseyRetryDebrief(getLevelById(7), metrics, 'top-out');
        expect(sequences.value).toBe(3);
        expect(sequences.progressLabel).toBe('3 / 7 cascade sequences');
        expect(sequences.remainingText).toBe('4 cascade sequences short of the goal.');
        expect(sequences.tip).toContain('Each locked piece can add one cascade sequence');

        const chain = getOdysseyRetryDebrief(soloLevel('combo', 7), metrics, 'top-out');
        expect(chain.value).toBe(4);
        expect(chain.progressLabel).toBe('Best chain: 4 / 7 waves');
        expect(chain.remainingText).toBe('Aim for 7 waves in one chain.');
        expect(chain.remainingText).not.toContain('3 waves');
        expect(chain.tip).toContain('The first clear counts as wave one');
        expect(chain.tip).toContain('clears on later pieces start a new chain');
    });

    it('keeps fractional survival time below the target until the full duration is reached', () => {
        const debrief = getOdysseyRetryDebrief(soloLevel('time', 60), { time: 59.999 }, 'top-out');
        expect(debrief.value).toBe(59.999);
        expect(debrief.progressLabel).toBe('59 / 60 seconds');
        expect(debrief.remainingText).toBe('1 second short of the goal.');
        expect(debrief.tip).toContain('while the timer runs');
    });

    it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1, '2'])(
        'falls back when the required metric is invalid (%s)',
        (lines) => {
            expect(getOdysseyRetryDebrief(getLevelById(1), { lines }, 'top-out')).toBeNull();
        },
    );

    it.each([undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, '20'])(
        'falls back when the primary target is invalid (%s)',
        (target) => {
            expect(getOdysseyRetryDebrief(soloLevel('lines', target), { lines: 0 }, 'top-out')).toBeNull();
        },
    );

    it('falls back for missing context instead of fabricating zero progress', () => {
        expect(getOdysseyRetryDebrief(undefined, {}, 'top-out')).toBeNull();
        expect(getOdysseyRetryDebrief({}, {}, 'top-out')).toBeNull();
        expect(getOdysseyRetryDebrief(getLevelById(1), undefined, 'top-out')).toBeNull();
        expect(getOdysseyRetryDebrief(getLevelById(1), {}, 'top-out')).toBeNull();
        expect(getOdysseyRetryDebrief(getLevelById(1), { score: 5000 }, 'top-out')).toBeNull();
    });

    it.each(['custom', 'height', 'tetrises', 'frags'])(
        'leaves unsupported %s goals to the existing failure presentation',
        (type) => {
            const metrics = { [type]: 1, undefined: 1 };
            expect(getOdysseyRetryDebrief(soloLevel(type, 7), metrics, 'top-out')).toBeNull();
        },
    );

    it.each([36000, 36033])('does not award completion for a fatal score-crossing lock (%i points)', (score) => {
        const debrief = getOdysseyRetryDebrief(getLevelById(49), { score }, 'top-out');
        expect(debrief.value).toBe(score);
        expect(debrief.remainingText).toBe('The final total met the target, but the level was not completed.');
        expect(debrief.remainingText).not.toContain('0 points short');
        expect(debrief.tip).toBe('Keep room at the top of the board until the goal is secured.');
        expect(debrief).not.toHaveProperty('stars');
        expect(debrief).not.toHaveProperty('bonuses');
        expect(debrief).not.toHaveProperty('completed');
    });

    it('explains late goal totals with the deadline rule rather than a spawn diagnosis', () => {
        const debrief = getOdysseyRetryDebrief(getLevelById(59), { score: 160100, time: 210.5 }, 'time');
        expect(debrief.remainingText).toContain('the level was not completed');
        expect(debrief.tip).toContain('within the time limit');
        expect(debrief.tip).toContain('final cascade to settle');
        expect(debrief.tip).not.toMatch(/before the time limit|top of the board|next piece/);
    });

    it('keeps optional mastery separate from a timed primary shortfall', () => {
        const debrief = getOdysseyRetryDebrief(getLevelById(55), {
            score: 249000, time: 480, maxCombo: 18, cascades: 35, tetrises: 20,
        }, 'time');
        expect(debrief.target).toBe(250000);
        expect(debrief.remainingText).toBe(`${(1000).toLocaleString()} points short of the goal.`);
        expect(debrief.tip).toContain('main goal within the time limit');
        expect(debrief.tip).toContain('extra stars can wait for a replay');
        expect(debrief.progressLabel).not.toContain((500000).toLocaleString());
        expect(debrief).not.toHaveProperty('stars');
    });

    it('teaches the score multiplier only when the level activates it', () => {
        const enabled = getOdysseyRetryDebrief(getLevelById(49), { score: 12000 }, 'time');
        const disabled = getOdysseyRetryDebrief(soloLevel('score', 36000), { score: 12000 }, 'time');
        expect(enabled.tip).toContain('consecutive pieces');
        expect(enabled.tip).toContain('score multiplier');
        expect(disabled.tip).not.toContain('multiplier');
        expect(disabled.tip).not.toContain('consecutive');
    });

    it('does not change authored goals, stars, bonuses or caller metrics while producing debriefs', () => {
        const originalLevels = structuredClone(LEVEL_CONFIGS);
        const metrics = Object.freeze({
            lines: 12, score: 5000, cascades: 2, maxCombo: 3, time: 30,
        });
        for (const level of LEVEL_CONFIGS) {
            getOdysseyRetryDebrief(level, metrics, 'top-out');
            getOdysseyRetryDebrief(level, metrics, 'time');
        }
        expect(LEVEL_CONFIGS).toEqual(originalLevels);
        expect(metrics).toEqual({
            lines: 12, score: 5000, cascades: 2, maxCombo: 3, time: 30,
        });
    });
});

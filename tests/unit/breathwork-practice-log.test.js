import { describe, expect, it } from 'vitest';
import {
    MAX_ENTRIES, PRACTICE_KEY, bestHoldFor, formatPracticeTime, readPracticeLog, recordPractice, summarizePractice,
} from '../../src/ui/effects/breathwork-practice-log.js';

const memory = (initial = {}) => {
    const values = new Map(Object.entries(initial));
    return {
        values,
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    };
};
/** Noon, local time, `days` before 5 October 2026 (DST cannot move it across midnight). */
const day = (days, hour = 12) => new Date(2026, 9, 5 - days, hour).getTime();
const open = (round, seconds, suggested = 60) => ({
    round, seconds, suggested, mode: 'open',
});

describe('Hale practice log', () => {
    it('starts empty, and keeps the totals of the first version of the log', () => {
        expect(readPracticeLog(memory())).toEqual({
            v: 2, count: 0, seconds: 0, last: null, entries: [],
        });
        const legacy = memory({ [PRACTICE_KEY]: JSON.stringify({ count: 3, seconds: 4200, last: { id: 'REST', at: day(2) } }) });
        expect(readPracticeLog(legacy)).toMatchObject({
            count: 3, seconds: 4200, last: { id: 'REST' }, entries: [],
        });
        expect(readPracticeLog(memory({ [PRACTICE_KEY]: '{broken' })).count).toBe(0);
    });

    it('counts a completed session, keeps an ended one as practice, and ignores a false start', () => {
        const store = memory();
        expect(recordPractice({ id: 'BASE', seconds: 1555, completed: true }, store, day(0)).recorded).toBe(true);
        expect(recordPractice({ id: 'BASE', seconds: 30, completed: false }, store, day(0)).recorded).toBe(false);
        expect(recordPractice({ id: 'FLOW', seconds: 300, completed: false }, store, day(0)).recorded).toBe(true);
        const log = readPracticeLog(store);
        expect(log).toMatchObject({ count: 1, seconds: 1855, last: { id: 'FLOW' } });
        expect(log.entries.map((entry) => entry.completed)).toEqual([true, false]);
    });

    it('calls a longer open hold a personal best, but not your first one, and never a timed pause', () => {
        const store = memory();
        const first = recordPractice({ id: 'BASE', seconds: 1500, holds: [open(1, 70), open(2, 95)] }, store, day(2));
        expect(first).toMatchObject({ personalBest: false, previousBest: 0, longestHold: 95 });
        const better = recordPractice({ id: 'BASE', seconds: 1500, holds: [open(1, 80), open(2, 101)] }, store, day(1));
        expect(better).toMatchObject({ personalBest: true, previousBest: 95, longestHold: 101 });
        const timed = recordPractice({
            id: 'REST', seconds: 1100, holds: [{ round: 1, seconds: 300, mode: 'timed' }],
        }, store, day(0));
        expect(timed.longestHold).toBe(0);
        expect(bestHoldFor(readPracticeLog(store), 'BASE')).toBe(101);
        expect(bestHoldFor(readPracticeLog(store), 'ELIXIR')).toBe(0);
    });

    it('counts a streak of days ending today, or yesterday while today is still open', () => {
        const store = memory();
        [3, 2, 1].forEach((days) => recordPractice({ id: 'REST', seconds: 600 }, store, day(days)));
        expect(summarizePractice(readPracticeLog(store), day(0)).streak).toBe(3);
        recordPractice({ id: 'REST', seconds: 600 }, store, day(0, 21));
        const summary = summarizePractice(readPracticeLog(store), day(0, 22));
        expect(summary.streak).toBe(4);
        expect(summary.week.map((entry) => entry.practised)).toEqual([false, false, false, true, true, true, true]);
        expect(summary.weekSeconds).toBe(2400);
        expect(summarizePractice(readPracticeLog(store), day(-2)).streak).toBe(0);
    });

    it('sums each session on its own', () => {
        const store = memory();
        recordPractice({ id: 'BASE', seconds: 1500, holds: [open(1, 75)] }, store, day(1));
        recordPractice({
            id: 'BASE', seconds: 400, completed: false, holds: [open(1, 90)],
        }, store, day(0));
        expect(summarizePractice(readPracticeLog(store), day(0)).bySession.BASE).toEqual({ count: 1, bestHold: 90, lastAt: day(0) });
    });

    it('keeps only the newest sittings', () => {
        const store = memory();
        for (let i = 0; i < MAX_ENTRIES + 5; i++) recordPractice({ id: 'FLOW', seconds: 100 }, store, day(0) + i);
        const log = readPracticeLog(store);
        expect(log.entries).toHaveLength(MAX_ENTRIES);
        expect(log.count).toBe(MAX_ENTRIES + 5);
        expect(log.entries[0].at).toBe(day(0) + 5);
    });

    it('writes practice time the way people say it', () => {
        expect(formatPracticeTime(45)).toBe('45 sec');
        expect(formatPracticeTime(1555)).toBe('26 min');
        expect(formatPracticeTime(3600)).toBe('1 h');
        expect(formatPracticeTime(15000)).toBe('4 h 10 min');
    });
});

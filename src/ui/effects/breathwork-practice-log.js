/**
 * The Sukha practice log: the sessions you have sat, kept on this device.
 *
 * One localStorage entry, `serenity.sukhaSessions`. Version 2 keeps the totals version 1 had
 * (`count` completed sessions, `seconds` of practice, `last`) so older readers still work, and
 * adds `entries`: one per sitting, newest last, capped at MAX_ENTRIES.
 *
 *   entry = { id, at, seconds, completed, rounds, breaths, holds: [{ round, seconds, suggested, mode }],
 *             intention }
 *
 * A hold's `mode` is 'open' when you chose when to breathe (every hold since 2026-11-12: a hold
 * always ends when you breathe in); an older sitting may hold 'timed'. Holds are kept as a note of
 * the sitting, never as a score, and are not shown: nothing here compares one hold with another or
 * names a best. A longer hold is not a better one.
 *
 * Pure functions take the storage they use, so tests and the game share one implementation.
 */
export const PRACTICE_KEY = 'serenity.sukhaSessions';
/** Where the log lived before the sessions were renamed (2026-11-03): read once, then moved. */
export const LEGACY_PRACTICE_KEY = 'serenity.haleSessions';
export const MAX_ENTRIES = 200;
/** A sitting shorter than this is not counted as practice (an accidental start). */
export const MIN_PRACTICE_SECONDS = 60;

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

function defaultStorage() {
    try {
        return globalThis.window?.localStorage ?? globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

function cleanHold(hold) {
    return {
        round: Math.max(0, Math.round(finite(hold?.round))),
        seconds: Math.max(0, Math.round(finite(hold?.seconds))),
        suggested: Math.max(0, Math.round(finite(hold?.suggested))),
        mode: hold?.mode === 'open' ? 'open' : 'timed',
    };
}

function cleanEntry(entry) {
    if (!entry || typeof entry.id !== 'string') return null;
    return {
        id: entry.id,
        at: finite(entry.at, Date.now()),
        seconds: Math.max(0, Math.round(finite(entry.seconds))),
        completed: entry.completed !== false,
        rounds: Math.max(0, Math.round(finite(entry.rounds))),
        breaths: Math.max(0, Math.round(finite(entry.breaths))),
        holds: Array.isArray(entry.holds) ? entry.holds.map(cleanHold) : [],
        intention: typeof entry.intention === 'string' ? entry.intention : null,
    };
}

/** @returns {{v: 2, count: number, seconds: number, last: object|null, entries: object[]}} */
export function readPracticeLog(storage = defaultStorage()) {
    const empty = {
        v: 2, count: 0, seconds: 0, last: null, entries: [],
    };
    let raw = null;
    try {
        raw = JSON.parse(storage?.getItem(PRACTICE_KEY) || storage?.getItem(LEGACY_PRACTICE_KEY) || 'null');
    } catch {
        return empty;
    }
    if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.count)) return empty;
    const entries = Array.isArray(raw.entries) ? raw.entries.map(cleanEntry).filter(Boolean) : [];
    return {
        v: 2,
        count: Math.max(0, Math.round(raw.count)),
        seconds: Math.max(0, Math.round(finite(raw.seconds))),
        last: raw.last && typeof raw.last.id === 'string' ? { id: raw.last.id, at: finite(raw.last.at, 0) } : null,
        entries,
    };
}

const dayKey = (time) => {
    const date = new Date(time);
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

/** Local midnight of the day `days` before the one holding `time` (DST-safe). */
const dayStart = (time, days = 0) => {
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - days).getTime();
};

/**
 * What the catalogue and the result screen say about your practice.
 * @param {ReturnType<typeof readPracticeLog>} log
 * @param {number} [now]
 */
export function summarizePractice(log, now = Date.now()) {
    const practised = new Set(log.entries.map((entry) => dayKey(entry.at)));
    // A streak is unbroken days ending today, or yesterday when today is still to come.
    let streak = 0;
    let offset = practised.has(dayKey(now)) ? 0 : 1;
    while (practised.has(dayKey(dayStart(now, offset)))) {
        streak += 1;
        offset += 1;
    }
    const week = Array.from({ length: 7 }, (_, index) => {
        const start = dayStart(now, 6 - index);
        return { start, practised: practised.has(dayKey(start)) };
    });
    const weekStart = dayStart(now, 6);
    const weekSeconds = log.entries
        .filter((entry) => entry.at >= weekStart && entry.at < dayStart(now, -1))
        .reduce((sum, entry) => sum + entry.seconds, 0);
    const bySession = {};
    log.entries.forEach((entry) => {
        const stats = bySession[entry.id] || { count: 0, lastAt: 0 };
        if (entry.completed) stats.count += 1;
        stats.lastAt = Math.max(stats.lastAt, entry.at);
        bySession[entry.id] = stats;
    });
    return {
        completed: log.count,
        seconds: log.seconds,
        last: log.last,
        streak,
        week,
        weekSeconds,
        bySession,
        hasHistory: log.count > 0 || log.entries.length > 0,
    };
}

/**
 * Add one sitting. A sitting shorter than MIN_PRACTICE_SECONDS is ignored unless it completed.
 * @returns {{recorded: boolean, log: ReturnType<typeof readPracticeLog>}}
 */
export function recordPractice(entry, storage = defaultStorage(), now = Date.now()) {
    const log = readPracticeLog(storage);
    const clean = cleanEntry({ at: now, ...entry });
    const result = { recorded: false, log };
    if (!clean || (!clean.completed && clean.seconds < MIN_PRACTICE_SECONDS)) return result;
    log.entries.push(clean);
    if (log.entries.length > MAX_ENTRIES) log.entries.splice(0, log.entries.length - MAX_ENTRIES);
    if (clean.completed) log.count += 1;
    log.seconds += clean.seconds;
    log.last = { id: clean.id, at: clean.at };
    try {
        storage?.setItem(PRACTICE_KEY, JSON.stringify(log));
        storage?.removeItem?.(LEGACY_PRACTICE_KEY);
        result.recorded = true;
    } catch { /* private browsing: the practice still happened */ }
    return result;
}

/** "4 h 10 min", "26 min", "45 sec". */
export function formatPracticeTime(seconds) {
    const safe = Math.max(0, Math.round(finite(seconds)));
    if (safe < 60) return `${safe} sec`;
    const minutes = Math.round(safe / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

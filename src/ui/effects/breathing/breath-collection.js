/**
 * Which breathing worlds and Hale sessions a player has found.
 *
 * Four worlds and Hale First Breath are open from the start. Each Odyssey chapter you finish
 * opens one world and the Hale session that features it (the world you then breathe with as you
 * arrive in the next chapter). Practice opens them too: every PRACTICE_MINUTES_PER_STEP minutes
 * of breathing opens the next one along the same path, so nobody who only breathes is ever
 * blocked. Nothing ever closes again, and an existing player keeps every world and session they
 * had already used when this arrived.
 *
 * Openings are derived from evidence (saved Odyssey completions, practice time) and kept as
 * permanent grants, so a cleared save or log never takes a world away. Whether an opening has
 * been seen ("New") is presentation, stored beside the grants and never deciding them. The
 * shape follows the theme collection (docs/THEME_COLLECTION_PROGRESSION_2026-10.md).
 */
import { CHAPTER_CONFIGS } from '../../../core/odyssey/data/chapters.js';
import { ODYSSEY_PROGRESS_STORAGE_KEY, getValidCompletedLevels } from '../../../core/progression/theme-collection-model.js';
import { migrateOdysseyProgressData } from '../../../core/odyssey/OdysseyStateManager.js';
import { BREATH_WORLDS } from './breath-catalogue.js';

export const BREATH_COLLECTION_STORAGE_KEY = 'serenityBlocks_breathCollection';
export const BREATH_COLLECTION_VERSION = 1;
/** Open from the start: balance, sleep, focus and stillness, so the right one is always there. */
export const STARTER_WORLDS = Object.freeze(['coherence', 'calm-sleep', 'box-breathing', 'zen-garden']);
export const STARTER_SESSIONS = Object.freeze(['FIRST']);
/** Breathing time that opens the next world and session for a player who does not travel. */
export const PRACTICE_MINUTES_PER_STEP = 15;

/**
 * The path: finishing chapter N opens a world and its session, met again as you arrive in the
 * next chapter (`place`). The last opens when the Odyssey is complete.
 */
export const BREATH_LADDER = Object.freeze([
    {
        chapter: 1, world: 'ocean-breath', session: 'TIDE', place: 'the Deep Ocean',
    },
    {
        chapter: 2, world: 'forest-breath', session: 'ROOTS', place: 'the Surface World',
    },
    {
        chapter: 3, world: 'deep-relaxation', session: 'UNWIND', place: 'the Mountains',
    },
    {
        chapter: 4, world: 'energizing', session: 'SUNRISE', place: 'the Sky',
    },
    {
        chapter: 5, world: 'cosmic-breath', session: 'REST', place: 'Space',
    },
    {
        chapter: 6, world: 'triangle', session: 'FLOW', place: 'the Black Hole',
    },
    {
        chapter: 7, world: 'electric-storm', session: 'BASE', place: 'Urban Dreams',
    },
    {
        chapter: 8, world: 'wim-hof', session: 'ELIXIR', place: null,
    },
].map((step) => Object.freeze(step)));

const KINDS = ['worlds', 'sessions'];
const STEP_KEY = { worlds: 'world', sessions: 'session' };
const STARTERS = { worlds: STARTER_WORLDS, sessions: STARTER_SESSIONS };

function emptyData() {
    return {
        version: BREATH_COLLECTION_VERSION,
        worlds: {},
        sessions: {},
        seen: { worlds: [], sessions: [] },
        legacyChecked: false,
    };
}

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** A saved collection, made safe: unknown ids and malformed entries are dropped. */
export function normalizeBreathCollection(raw, known = {}) {
    const data = emptyData();
    if (!isRecord(raw) || raw.version !== BREATH_COLLECTION_VERSION) return data;
    KINDS.forEach((kind) => {
        const valid = known[kind];
        Object.entries(isRecord(raw[kind]) ? raw[kind] : {}).forEach(([id, source]) => {
            if (typeof source === 'string' && (!valid || valid.has(id))) data[kind][id] = source;
        });
        const seen = isRecord(raw.seen) && Array.isArray(raw.seen[kind]) ? raw.seen[kind] : [];
        data.seen[kind] = [...new Set(seen.filter((id) => typeof id === 'string' && (!valid || valid.has(id))))];
    });
    data.legacyChecked = raw.legacyChecked === true;
    return data;
}

/** Chapters whose every orb has a valid saved completion. */
export function completedChaptersFrom(progress, chapters = CHAPTER_CONFIGS) {
    const levels = chapters.flatMap(({ levelRange: [first, last] }) => Array.from({ length: last - first + 1 }, (_, i) => ({ id: first + i })));
    const completed = getValidCompletedLevels(progress, levels);
    return chapters.filter(({ levelRange: [first, last] }) => {
        for (let id = first; id <= last; id += 1) if (!completed.has(id)) return false;
        return true;
    }).map(({ id }) => id);
}

/**
 * Everything open, from the evidence: starters, finished chapters, earlier grants, then
 * practice, which opens the next closed steps of the path in order.
 * @returns {{worlds: Map<string,string>, sessions: Map<string,string>, practice: object}}
 *   id → why it is open ('starter', 'odyssey', 'practice', 'legacy', ...)
 */
export function deriveBreathOpenings({ completedChapters = [], practiceSeconds = 0, grants = null } = {}) {
    const open = { worlds: new Map(), sessions: new Map() };
    KINDS.forEach((kind) => STARTERS[kind].forEach((id) => open[kind].set(id, 'starter')));
    const chapters = new Set(completedChapters);
    BREATH_LADDER.forEach((step) => {
        if (!chapters.has(step.chapter)) return;
        KINDS.forEach((kind) => { if (!open[kind].has(step[STEP_KEY[kind]])) open[kind].set(step[STEP_KEY[kind]], 'odyssey'); });
    });
    KINDS.forEach((kind) => Object.entries(grants?.[kind] || {}).forEach(([id, source]) => {
        if (!open[kind].has(id)) open[kind].set(id, source);
    }));
    const stepOpen = (step) => KINDS.every((kind) => open[kind].has(step[STEP_KEY[kind]]));
    const minutes = Math.max(0, Number(practiceSeconds) || 0) / 60;
    const earned = Math.floor(minutes / PRACTICE_MINUTES_PER_STEP);
    // Steps practice already opened (kept as grants) have had their minutes.
    const paid = BREATH_LADDER.filter((step) => KINDS.some((kind) => grants?.[kind]?.[step[STEP_KEY[kind]]] === 'practice')).length;
    let credits = Math.max(0, earned - paid);
    BREATH_LADDER.forEach((step) => {
        if (credits <= 0 || stepOpen(step)) return;
        KINDS.forEach((kind) => { if (!open[kind].has(step[STEP_KEY[kind]])) open[kind].set(step[STEP_KEY[kind]], 'practice'); });
        credits -= 1;
    });
    return {
        ...open,
        practice: {
            minutes,
            // Minutes into the next opening: below zero while earlier openings are still owed
            // their minutes (a practice record cleared after it had opened something).
            carried: minutes - Math.max(earned, paid) * PRACTICE_MINUTES_PER_STEP,
            unspent: credits,
        },
    };
}

/** What a closed world or session needs: where it is found, and how much practice opens it. */
export function breathRequirement(kind, id, openings) {
    const index = BREATH_LADDER.findIndex((step) => step[STEP_KEY[kind]] === id);
    if (index < 0) return null;
    const step = BREATH_LADDER[index];
    // Practice opens closed steps in order: this one waits behind every closed step before it.
    const closedBefore = BREATH_LADDER.slice(0, index + 1)
        .filter((candidate) => KINDS.some((k) => !openings[k].has(candidate[STEP_KEY[k]]))).length;
    const minutes = Math.max(1, Math.ceil(closedBefore * PRACTICE_MINUTES_PER_STEP - openings.practice.carried));
    const where = step.place ? `Opens when you reach ${step.place}` : 'Opens when you complete the Odyssey';
    return {
        chapter: step.chapter,
        place: step.place,
        practiceMinutes: minutes,
        label: `${where}, or after ${minutes} more minute${minutes === 1 ? '' : 's'} of breathing`,
        short: step.place ? `Found in ${step.place}` : 'Found at the end of the Odyssey',
    };
}

/** The opened ids that `after` has and `before` lacks, in path order. */
function newlyOpened(before, after) {
    const order = (kind) => [...STARTERS[kind], ...BREATH_LADDER.map((step) => step[STEP_KEY[kind]])];
    return Object.fromEntries(KINDS.map((kind) => [kind, order(kind).filter((id) => after[kind].has(id) && !before[kind].has(id))]));
}

/**
 * The service the Hub, the Odyssey and the breathing guide share. Sources are injected so tests
 * (and Steam Cloud, later) can drive it; `getBreathCollection()` builds the game's one instance.
 */
export class BreathCollectionService {
    constructor({
        storage = null,
        readOdysseyProgress = () => null,
        readPracticeSeconds = () => 0,
        readLegacyEvidence = () => ({ worlds: [], sessions: [] }),
        knownWorlds = BREATH_WORLDS.map((world) => world.id),
        knownSessions = ['FIRST', ...BREATH_LADDER.map((step) => step.session)],
        developmentUnlockAll = false,
    } = {}) {
        this.storage = storage;
        this.readOdysseyProgress = readOdysseyProgress;
        this.readPracticeSeconds = readPracticeSeconds;
        this.readLegacyEvidence = readLegacyEvidence;
        this.known = { worlds: new Set(knownWorlds), sessions: new Set(knownSessions) };
        this.developmentUnlockAll = developmentUnlockAll;
        this.listeners = new Set();
        this.data = this._load();
        this.openings = null;
        this.reconcile({ silent: true });
    }

    _load() {
        try {
            const raw = this.storage?.getItem(BREATH_COLLECTION_STORAGE_KEY);
            return normalizeBreathCollection(raw ? JSON.parse(raw) : null, this.known);
        } catch {
            return emptyData();
        }
    }

    _save() {
        try {
            this.storage?.setItem(BREATH_COLLECTION_STORAGE_KEY, JSON.stringify(this.data));
            return true;
        } catch {
            return false;
        }
    }

    _derive() {
        let chapters = [];
        try { chapters = completedChaptersFrom(this.readOdysseyProgress()); } catch { chapters = []; }
        let seconds = 0;
        try { seconds = Number(this.readPracticeSeconds()) || 0; } catch { seconds = 0; }
        return deriveBreathOpenings({ completedChapters: chapters, practiceSeconds: seconds, grants: this.data });
    }

    /**
     * Bring the grants up to date with the evidence. Returns what newly opened (for a
     * celebration), or null when nothing did. `silent` keeps a quiet recomputation (loading,
     * opening a tab) from being announced: its openings are still marked new in the Hub.
     */
    reconcile({ silent = false, source = 'evidence' } = {}) {
        const before = this.openings || { worlds: new Map(), sessions: new Map() };
        if (!this.data.legacyChecked) this._importLegacy();
        const openings = this._derive();
        let changed = false;
        KINDS.forEach((kind) => openings[kind].forEach((source, id) => {
            if (source === 'starter' || this.data[kind][id] || !this.known[kind].has(id)) return;
            this.data[kind][id] = source;
            changed = true;
        }));
        if (changed) this._save();
        this.openings = openings;
        // The first reconciliation (loading) has nothing before it to announce against.
        const opened = before.worlds.size ? newlyOpened(before, openings) : { worlds: [], sessions: [] };
        const any = opened.worlds.length || opened.sessions.length;
        if (changed || any) this._emit({ opened, silent, source });
        return any && !silent ? opened : null;
    }

    /** An existing player keeps what they had used before worlds could be locked. */
    _importLegacy() {
        let evidence = { worlds: [], sessions: [] };
        try { evidence = this.readLegacyEvidence() || evidence; } catch { /* nothing to keep */ }
        KINDS.forEach((kind) => (evidence[kind] || []).forEach((id) => {
            if (this.known[kind].has(id) && !STARTERS[kind].includes(id) && !this.data[kind][id]) {
                this.data[kind][id] = 'legacy';
                // Already familiar: kept quietly, never announced as new.
                if (!this.data.seen[kind].includes(id)) this.data.seen[kind].push(id);
            }
        }));
        this.data.legacyChecked = true;
        this._save();
    }

    isWorldOpen(id) {
        return this.developmentUnlockAll || this.openings.worlds.has(id);
    }

    isSessionOpen(id) {
        return this.developmentUnlockAll || this.openings.sessions.has(id);
    }

    /** { open, isNew, requirement } for a world ('worlds') or a session ('sessions'). */
    status(kind, id) {
        const open = kind === 'worlds' ? this.isWorldOpen(id) : this.isSessionOpen(id);
        const source = this.openings[kind].get(id);
        const isNew = Boolean(open && source && source !== 'starter' && source !== 'legacy'
            && !this.data.seen[kind].includes(id) && !this.developmentUnlockAll);
        return { open, isNew, requirement: open ? null : breathRequirement(kind, id, this.openings) };
    }

    /** How many are open, of how many. */
    summary(kind) {
        const total = this.known[kind].size;
        const open = this.developmentUnlockAll ? total : [...this.known[kind]].filter((id) => this.openings[kind].has(id)).length;
        const fresh = [...this.known[kind]].filter((id) => this.status(kind, id).isNew).length;
        return { open, total, new: fresh };
    }

    /** A new opening has been shown to you: it is no longer marked new. */
    markSeen(kind, id) {
        if (!this.known[kind]?.has(id) || this.data.seen[kind].includes(id)) return false;
        this.data.seen[kind].push(id);
        this._save();
        this._emit({ opened: { worlds: [], sessions: [] }, silent: true });
        return true;
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    _emit(event) {
        this.listeners.forEach((listener) => {
            try { listener(event); } catch { /* a listener must not break the collection */ }
        });
    }
}

/** Saved Odyssey progress, migrated like the theme collection reads it. */
export function readSavedOdysseyProgress(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem(ODYSSEY_PROGRESS_STORAGE_KEY);
        return raw ? migrateOdysseyProgressData(JSON.parse(raw)) : null;
    } catch {
        return null;
    }
}

import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    BREATH_COLLECTION_STORAGE_KEY, BREATH_LADDER, BreathCollectionService, PRACTICE_MINUTES_PER_STEP,
    STARTER_SESSIONS, STARTER_WORLDS, breathRequirement, completedChaptersFrom, deriveBreathOpenings,
    readSavedOdysseyProgress,
} from '../../src/ui/effects/breathing/breath-collection.js';
import {
    isDevelopmentBreathUnlocked, readBreathPracticeSeconds, readLegacyBreathEvidence,
} from '../../src/ui/effects/breathing/breath-collection-store.js';
import {
    BREATH_PRACTICE_KEY, MAX_STRETCH_SECONDS, MIN_STRETCH_SECONDS, addBreathPractice, readBreathPractice,
    trackStandalonePractice,
} from '../../src/ui/effects/breathing/breath-practice.js';
import { announceBreathOpenings, describeOpenings, haleSessionName } from '../../src/ui/effects/breathing/breath-openings.js';
import { BREATH_WORLDS, getBreathWorld } from '../../src/ui/effects/breathing/breath-catalogue.js';
import { SESSION_WORLDS } from '../../src/ui/effects/breathing/session-worlds.js';
import { CHAPTER_BREATH_WORLDS } from '../../src/ui/odyssey/chapter-breath.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { PRACTICE_KEY } from '../../src/ui/effects/breathwork-practice-log.js';
import { showToast } from '../../src/ui/components/toast.js';

vi.mock('../../src/ui/components/toast.js', () => ({ showToast: vi.fn() }));

function memoryStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: (key) => map.delete(key),
        map,
    };
}

/** An Odyssey save with every orb of these chapters completed. */
function finished(...chapters) {
    const completedLevels = {};
    chapters.forEach((id) => {
        const { levelRange: [first, last] } = CHAPTER_CONFIGS.find((chapter) => chapter.id === id);
        for (let level = first; level <= last; level += 1) completedLevels[String(level)] = { stars: 2 };
    });
    return { version: 4, completedLevels };
}

function makeService({
    chapters = [], minutes = 0, legacy = null, storage = memoryStorage(), ...options
} = {}) {
    const evidence = { progress: finished(...chapters), seconds: minutes * 60, legacy };
    const collection = new BreathCollectionService({
        storage,
        readOdysseyProgress: () => evidence.progress,
        readPracticeSeconds: () => evidence.seconds,
        readLegacyEvidence: vi.fn(() => evidence.legacy || { worlds: [], sessions: [] }),
        ...options,
    });
    return { collection, evidence, storage };
}

const openIds = (collection, kind) => (kind === 'worlds' ? BREATH_WORLDS.map((world) => world.id) : Object.keys(SESSION_WORLDS))
    .filter((id) => collection.status(kind, id).open);

afterEach(() => vi.clearAllMocks());

describe('The breath path', () => {
    it('opens four worlds and Hale First Breath from the start, one for each need', () => {
        const intents = STARTER_WORLDS.map((id) => getBreathWorld(id).intent);
        expect(intents).toEqual(['Balance', 'Sleep', 'Focus', 'Stillness']);
        expect(STARTER_SESSIONS).toEqual(['FIRST']);
        const { collection } = makeService();
        expect(openIds(collection, 'worlds')).toEqual(expect.arrayContaining([...STARTER_WORLDS]));
        expect(openIds(collection, 'worlds')).toHaveLength(4);
        expect(openIds(collection, 'sessions')).toEqual(['FIRST']);
        expect(collection.summary('worlds')).toEqual({ open: 4, total: 12, new: 0 });
        expect(collection.summary('sessions')).toEqual({ open: 1, total: 9, new: 0 });
    });

    it('walks every other world and session once, each session beside the world it features', () => {
        expect(BREATH_LADDER.map((step) => step.chapter)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect([...STARTER_WORLDS, ...BREATH_LADDER.map((step) => step.world)].sort())
            .toEqual(BREATH_WORLDS.map((world) => world.id).sort());
        expect([...STARTER_SESSIONS, ...BREATH_LADDER.map((step) => step.session)].sort())
            .toEqual(Object.keys(SESSION_WORLDS).sort());
        BREATH_LADDER.forEach((step) => expect(SESSION_WORLDS[step.session].featured, step.session).toBe(step.world));
        expect(SESSION_WORLDS.FIRST.featured).toBe(STARTER_WORLDS[0]);
    });

    it('opens each session only once every world it passes through is open', () => {
        const openBy = new Map(STARTER_WORLDS.map((id) => [id, -1]));
        BREATH_LADDER.forEach((step, index) => openBy.set(step.world, index));
        const sessionStep = new Map([['FIRST', -1], ...BREATH_LADDER.map((step, index) => [step.session, index])]);
        Object.entries(SESSION_WORLDS).forEach(([session, stages]) => {
            Object.values(stages).flat().forEach((world) => {
                expect(openBy.get(world), `${session} passes through ${world}`).toBeLessThanOrEqual(sessionStep.get(session));
            });
        });
    });

    it('meets each opened world again as you arrive in the next chapter, named for that place', () => {
        expect(STARTER_WORLDS).toContain(CHAPTER_BREATH_WORLDS[1]);
        BREATH_LADDER.forEach((step) => {
            const next = CHAPTER_CONFIGS.find((chapter) => chapter.id === step.chapter + 1);
            if (!next) {
                expect(step.place).toBeNull();
                return;
            }
            expect(CHAPTER_BREATH_WORLDS[next.id], `arriving in chapter ${next.id}`).toBe(step.world);
            const place = step.place.replace(/^the /, '');
            expect(next.name.startsWith(place), `${step.place} / ${next.name}`).toBe(true);
        });
    });
});

describe('Opening worlds and sessions', () => {
    it('opens a world and its session when a whole chapter is finished', () => {
        const { collection } = makeService({ chapters: [1] });
        expect(collection.isWorldOpen('ocean-breath')).toBe(true);
        expect(collection.isSessionOpen('TIDE')).toBe(true);
        expect(collection.isWorldOpen('forest-breath')).toBe(false);
        expect(completedChaptersFrom(finished(1, 2))).toEqual([1, 2]);
        const partial = finished(2);
        delete partial.completedLevels['10'];
        expect(completedChaptersFrom(partial)).toEqual([]);
        // A completion without a valid rating is not a completion.
        expect(completedChaptersFrom({ completedLevels: { 1: { stars: 0 }, 2: {}, 3: { stars: 3 } } })).toEqual([]);
    });

    it('opens the next closed step for every fifteen minutes of breathing, counting each minute once', () => {
        const { collection, evidence } = makeService({ minutes: PRACTICE_MINUTES_PER_STEP - 1 });
        expect(collection.isSessionOpen('TIDE')).toBe(false);
        evidence.seconds = PRACTICE_MINUTES_PER_STEP * 60;
        expect(collection.reconcile()).toEqual({ worlds: ['ocean-breath'], sessions: ['TIDE'] });
        // The first step's minutes are spent: half an hour opens a second step, not a second and third.
        evidence.seconds = 2 * PRACTICE_MINUTES_PER_STEP * 60;
        expect(collection.reconcile()).toEqual({ worlds: ['forest-breath'], sessions: ['ROOTS'] });
        expect(collection.reconcile()).toBeNull();
        expect(openIds(collection, 'sessions')).toEqual(['FIRST', 'TIDE', 'ROOTS']);
        const reloaded = makeService({ minutes: 2 * PRACTICE_MINUTES_PER_STEP, storage: collection.storage }).collection;
        expect(openIds(reloaded, 'sessions')).toEqual(['FIRST', 'TIDE', 'ROOTS']);
    });

    it('spends practice on the steps the Odyssey has not opened', () => {
        const { collection } = makeService({ chapters: [1], minutes: PRACTICE_MINUTES_PER_STEP });
        expect(openIds(collection, 'sessions')).toEqual(['FIRST', 'TIDE', 'ROOTS']);
        const derived = deriveBreathOpenings({ completedChapters: [1, 2], practiceSeconds: 40 * 60 });
        expect(derived.sessions.get('TIDE')).toBe('odyssey');
        expect(derived.sessions.get('UNWIND')).toBe('practice');
        expect(derived.sessions.get('SUNRISE')).toBe('practice');
        expect(derived.sessions.has('REST')).toBe(false);
        expect(derived.practice.carried).toBe(10);
    });

    it('says where a closed world is found, and how much breathing opens it instead', () => {
        const { collection, evidence } = makeService({ minutes: 10 });
        expect(collection.status('worlds', 'ocean-breath').requirement).toEqual({
            chapter: 1,
            place: 'the Deep Ocean',
            practiceMinutes: 5,
            label: 'Opens when you reach the Deep Ocean, or after 5 more minutes of breathing',
            short: 'Found in the Deep Ocean',
        });
        // It waits behind every closed step before it.
        expect(collection.status('sessions', 'ROOTS').requirement.practiceMinutes).toBe(20);
        expect(collection.status('sessions', 'ELIXIR').requirement).toMatchObject({
            place: null,
            label: 'Opens when you complete the Odyssey, or after 110 more minutes of breathing',
            short: 'Found at the end of the Odyssey',
        });
        evidence.seconds = 14.5 * 60;
        collection.reconcile();
        expect(collection.status('worlds', 'ocean-breath').requirement.label).toMatch(/after 1 more minute of breathing$/);
        expect(collection.status('worlds', 'coherence').requirement).toBeNull();
        expect(breathRequirement('worlds', 'coherence', collection.openings)).toBeNull();
    });

    it('never takes an opening away', () => {
        const { collection, evidence } = makeService({ chapters: [1, 2], minutes: PRACTICE_MINUTES_PER_STEP });
        expect(openIds(collection, 'sessions')).toEqual(['FIRST', 'TIDE', 'ROOTS', 'UNWIND']);
        evidence.progress = null;
        evidence.seconds = 0;
        collection.reconcile();
        expect(openIds(collection, 'sessions')).toEqual(['FIRST', 'TIDE', 'ROOTS', 'UNWIND']);
        // The opening practice paid for stays paid: the next needs its own minutes on top.
        expect(collection.status('sessions', 'SUNRISE').requirement.practiceMinutes).toBe(2 * PRACTICE_MINUTES_PER_STEP);
        const reloaded = makeService({ storage: collection.storage }).collection;
        expect(openIds(reloaded, 'worlds')).toEqual(expect.arrayContaining(['ocean-breath', 'forest-breath', 'deep-relaxation']));
    });

    it('keeps what an existing player had used, quietly and only once', () => {
        const legacy = { worlds: ['electric-storm', 'cosmic-breath', 'coherence', 'not-a-world'], sessions: ['BASE', 'NOPE'] };
        const { collection, storage } = makeService({ legacy });
        expect(collection.isSessionOpen('BASE')).toBe(true);
        expect(collection.isWorldOpen('electric-storm')).toBe(true);
        expect(collection.status('sessions', 'BASE').isNew).toBe(false);
        expect(collection.status('worlds', 'cosmic-breath').isNew).toBe(false);
        const saved = JSON.parse(storage.getItem(BREATH_COLLECTION_STORAGE_KEY));
        expect(saved.sessions).toEqual({ BASE: 'legacy' });
        expect(saved.legacyChecked).toBe(true);
        const again = makeService({ storage, legacy: { worlds: ['wim-hof'], sessions: ['ELIXIR'] } }).collection;
        expect(again.readLegacyEvidence).not.toHaveBeenCalled();
        expect(again.isSessionOpen('ELIXIR')).toBe(false);
    });

    it('marks an opening new until it has been seen; starters and kept ones never are', () => {
        const { collection, storage } = makeService({ chapters: [1] });
        expect(collection.status('worlds', 'ocean-breath')).toMatchObject({ open: true, isNew: true });
        expect(collection.status('sessions', 'TIDE').isNew).toBe(true);
        expect(collection.status('worlds', 'coherence').isNew).toBe(false);
        expect(collection.summary('worlds')).toEqual({ open: 5, total: 12, new: 1 });
        const listener = vi.fn();
        collection.subscribe(listener);
        expect(collection.markSeen('worlds', 'ocean-breath')).toBe(true);
        expect(collection.markSeen('worlds', 'ocean-breath')).toBe(false);
        expect(collection.markSeen('worlds', 'not-a-world')).toBe(false);
        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith({ opened: { worlds: [], sessions: [] }, silent: true });
        expect(makeService({ chapters: [1], storage }).collection.status('worlds', 'ocean-breath').isNew).toBe(false);
    });

    it('announces only what newly opened, and lets a quiet look open things without a fanfare', () => {
        const { collection, evidence } = makeService();
        const listener = vi.fn();
        const unsubscribe = collection.subscribe(listener);
        expect(collection.reconcile()).toBeNull();
        expect(listener).not.toHaveBeenCalled();
        evidence.progress = finished(1);
        expect(collection.reconcile({ silent: true })).toBeNull();
        expect(listener).toHaveBeenLastCalledWith({ opened: { worlds: ['ocean-breath'], sessions: ['TIDE'] }, silent: true, source: 'evidence' });
        expect(collection.status('sessions', 'TIDE').isNew).toBe(true);
        evidence.progress = finished(1, 2);
        expect(collection.reconcile({ source: 'odyssey' })).toEqual({ worlds: ['forest-breath'], sessions: ['ROOTS'] });
        expect(listener).toHaveBeenLastCalledWith({ opened: { worlds: ['forest-breath'], sessions: ['ROOTS'] }, silent: false, source: 'odyssey' });
        unsubscribe();
        evidence.progress = finished(1, 2, 3);
        collection.reconcile();
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('survives a damaged or foreign save, and evidence it cannot read', () => {
        const damaged = makeService({ storage: memoryStorage({ [BREATH_COLLECTION_STORAGE_KEY]: '{not json' }) }).collection;
        expect(openIds(damaged, 'worlds')).toHaveLength(4);
        const future = memoryStorage({ [BREATH_COLLECTION_STORAGE_KEY]: JSON.stringify({ version: 99, sessions: { ELIXIR: 'odyssey' } }) });
        expect(makeService({ storage: future }).collection.isSessionOpen('ELIXIR')).toBe(false);
        const foreign = memoryStorage({
            [BREATH_COLLECTION_STORAGE_KEY]: JSON.stringify({
                version: 1, worlds: { 'wim-hof': 'odyssey', 'made-up': 'odyssey', triangle: 7 }, sessions: [], seen: { worlds: ['wim-hof', 3] }, legacyChecked: true,
            }),
        });
        const kept = makeService({ storage: foreign }).collection;
        expect(kept.isWorldOpen('wim-hof')).toBe(true);
        expect(kept.isWorldOpen('triangle')).toBe(false);
        expect(kept.status('worlds', 'wim-hof').isNew).toBe(false);
        const broken = new BreathCollectionService({
            readOdysseyProgress: () => { throw new Error('no save'); },
            readPracticeSeconds: () => { throw new Error('no log'); },
            readLegacyEvidence: () => { throw new Error('no settings'); },
        });
        expect(openIds(broken, 'sessions')).toEqual(['FIRST']);
    });

    it('opens everything for a development preview without calling any of it new', () => {
        const { collection, storage } = makeService({ developmentUnlockAll: true });
        expect(openIds(collection, 'worlds')).toHaveLength(12);
        expect(openIds(collection, 'sessions')).toHaveLength(9);
        expect(collection.summary('sessions')).toEqual({ open: 9, total: 9, new: 0 });
        expect(collection.status('sessions', 'ELIXIR')).toEqual({ open: true, isNew: false, requirement: null });
        // A preview is never stored as an opening.
        expect(JSON.parse(storage.getItem(BREATH_COLLECTION_STORAGE_KEY)).sessions).toEqual({});
    });
});

describe('Evidence the collection reads', () => {
    const log = (entries, last = entries.at(-1)) => JSON.stringify({
        v: 2, count: entries.length, seconds: entries.reduce((sum, entry) => sum + entry.seconds, 0), last, entries,
    });

    it('takes an existing player\'s sessions, the worlds those pass through, their practice and their chosen world', () => {
        const storage = memoryStorage({
            [PRACTICE_KEY]: log([{ id: 'BASE', at: 1, seconds: 900 }]),
            [BREATH_PRACTICE_KEY]: JSON.stringify({ v: 1, worlds: { triangle: 120 } }),
            serenityBlocksSettings: JSON.stringify({ breathingTechnique: 'deep-relaxation' }),
        });
        const evidence = readLegacyBreathEvidence(storage);
        expect(evidence.sessions).toEqual(['BASE']);
        expect(evidence.worlds).toEqual(expect.arrayContaining(['forest-breath', 'electric-storm', 'cosmic-breath', 'triangle', 'deep-relaxation']));
        expect(evidence.worlds).not.toContain('featured');
        expect(readBreathPracticeSeconds(storage)).toBe(1020);
    });

    it('does not count the old default world as a sign of anything on its own', () => {
        const fresh = memoryStorage({ serenityBlocksSettings: JSON.stringify({ breathingTechnique: 'deep-relaxation' }) });
        expect(readLegacyBreathEvidence(fresh)).toEqual({ worlds: [], sessions: [] });
        const chose = memoryStorage({ serenityBlocksSettings: JSON.stringify({ breathingTechnique: 'wim-hof' }) });
        expect(readLegacyBreathEvidence(chose)).toEqual({ worlds: ['wim-hof'], sessions: [] });
        expect(readLegacyBreathEvidence(memoryStorage({ serenityBlocksSettings: '{oops' }))).toEqual({ worlds: [], sessions: [] });
    });

    it('reads the Odyssey save the way the game migrates it, and opens previews only from the address', () => {
        const storage = memoryStorage({ serenityBlocks_odysseyProgress: JSON.stringify(finished(1)) });
        expect(completedChaptersFrom(readSavedOdysseyProgress(storage))).toEqual([1]);
        expect(readSavedOdysseyProgress(memoryStorage({ serenityBlocks_odysseyProgress: '{' }))).toBeNull();
        expect(isDevelopmentBreathUnlocked('?unlockAll=1')).toBe(true);
        expect(isDevelopmentBreathUnlocked('?unlockAll=true')).toBe(false);
        expect(isDevelopmentBreathUnlocked('')).toBe(false);
    });
});

describe('Stand-alone practice', () => {
    it('counts a stretch in one world, not a glimpse, and never more than half an hour at once', () => {
        const storage = memoryStorage();
        expect(addBreathPractice('ocean-breath', MIN_STRETCH_SECONDS - 1, storage)).toBe(false);
        expect(addBreathPractice('ocean-breath', 95.4, storage)).toBe(true);
        expect(addBreathPractice('ocean-breath', 4 * 60 * 60, storage)).toBe(true);
        expect(addBreathPractice('', 300, storage)).toBe(false);
        expect(readBreathPractice(storage)).toEqual({ v: 1, seconds: 95 + MAX_STRETCH_SECONDS, worlds: { 'ocean-breath': 95 + MAX_STRETCH_SECONDS } });
        expect(readBreathPractice(memoryStorage({ [BREATH_PRACTICE_KEY]: '{"worlds":{"a":-4,"b":"x","c":30}}' })).seconds).toBe(30);
    });

    it('follows the guide: a world change or a hidden page ends a stretch, a Hale session is not counted', () => {
        const storage = memoryStorage();
        const target = new EventTarget();
        const doc = Object.assign(new EventTarget(), { hidden: false });
        let time = 0;
        const guide = { isActive: false, isExternallyControlled: false, currentTechnique: 'coherence' };
        const onRecorded = vi.fn();
        const tracker = trackStandalonePractice({
            guide, storage, now: () => time, onRecorded, target, doc,
        });
        const fire = (type, on = target) => on.dispatchEvent(new Event(type));
        guide.isActive = true;
        fire('breathingGuideChange');
        time = 60_000;
        guide.currentTechnique = 'calm-sleep';
        fire('breathingTechniqueChange');
        expect(readBreathPractice(storage).worlds).toEqual({ coherence: 60 });
        expect(onRecorded).toHaveBeenCalledOnce();
        time = 70_000;
        doc.hidden = true;
        fire('visibilitychange', doc);
        // Ten seconds in Moonlit Waters was a glimpse.
        expect(readBreathPractice(storage).worlds).toEqual({ coherence: 60 });
        expect(onRecorded).toHaveBeenCalledOnce();
        doc.hidden = false;
        guide.isExternallyControlled = true;
        fire('visibilitychange', doc);
        time = 600_000;
        guide.isExternallyControlled = false;
        guide.isActive = false;
        fire('breathingGuideChange');
        expect(readBreathPractice(storage).seconds).toBe(60);
        guide.isActive = true;
        fire('breathingGuideChange');
        time = 700_000;
        tracker.stop();
        expect(readBreathPractice(storage).worlds).toEqual({ coherence: 60, 'calm-sleep': 100 });
        time = 900_000;
        fire('breathingTechniqueChange');
        expect(readBreathPractice(storage).seconds).toBe(160);
    });
});

describe('Words for an opening', () => {
    it('names worlds and Hale sessions the way the game does', () => {
        expect(haleSessionName('FIRST')).toBe('Hale First Breath');
        expect(haleSessionName('TIDE')).toBe('Hale Tide');
        expect(describeOpenings({ worlds: ['ocean-breath'], sessions: ['TIDE'] })).toEqual({
            worlds: [{ id: 'ocean-breath', name: 'Ocean Tide' }],
            sessions: [{ id: 'TIDE', name: 'Hale Tide' }],
            line: 'Ocean Tide and Hale Tide are yours now',
        });
        expect(describeOpenings({ worlds: ['forest-breath', 'deep-relaxation'], sessions: ['ROOTS'] }).line)
            .toBe('Ancient Forest, Aurora Dreams and Hale Roots are yours now');
        expect(describeOpenings({ worlds: ['not-a-world'], sessions: ['REST'] }).line).toBe('Hale Rest is yours now');
        expect(describeOpenings({ worlds: [], sessions: [] })).toBeNull();
        expect(describeOpenings(null)).toBeNull();
    });

    it('marks an opening by practice with a quiet toast', () => {
        expect(announceBreathOpenings(null)).toBeNull();
        expect(showToast).not.toHaveBeenCalled();
        announceBreathOpenings({ worlds: ['ocean-breath'], sessions: ['TIDE'] });
        expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
            type: 'success', message: 'Your breathing opened something new: Ocean Tide and Hale Tide are yours now.',
        }));
    });
});

import {
    beforeEach, afterEach, describe, expect, it, vi,
} from 'vitest';
import { ThemeCollectionService } from '../../src/core/progression/theme-collection-service.js';
import {
    THEME_COLLECTION_STORAGE_KEY, THEME_COLLECTION_RECOVERY_STORAGE_KEY, ODYSSEY_PROGRESS_STORAGE_KEY,
    createThemeCollectionData, mergeThemeCollections,
} from '../../src/core/progression/theme-collection-model.js';
import { THEME_REGISTRY, resolveThemeId } from '../../src/themes/theme-registry.js';
import { ODYSSEY_COLLECTION_REWARDS } from '../../src/themes/theme-collection.js';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { OdysseyStateManager, migrateOdysseyProgressData } from '../../src/core/odyssey/OdysseyStateManager.js';

let storage;
let registry;
const now = () => Date.parse('2026-10-08T12:00:00.000Z');
const success = {
    stars: 1, score: 1000, time: 60, lines: 20, bonuses: [],
};

function createCollection() {
    return new ThemeCollectionService({
        catalog: THEME_REGISTRY,
        levels: registry.getAllLevels(),
        rules: ODYSSEY_COLLECTION_REWARDS,
        resolveThemeId,
        migrateProgress: migrateOdysseyProgressData,
        storage,
        now,
    });
}

function complete(collection, state, levelId) {
    const result = state.completeLevel(levelId, success);
    return collection.awardCompletion({
        levelId,
        themeId: registry.getLevel(levelId).theme.primary,
        odysseyState: state,
        progressPersisted: result.persisted,
    });
}

beforeEach(() => {
    const values = new Map();
    storage = {
        getItem: vi.fn((key) => values.get(key) ?? null),
        setItem: vi.fn((key, value) => values.set(key, value)),
        removeItem: vi.fn((key) => values.delete(key)),
    };
    vi.stubGlobal('localStorage', storage);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registry = new LevelRegistry();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('durable Odyssey theme collection', () => {
    it('starts with Forest only and gives every registered theme an attainable route', () => {
        const collection = createCollection();
        expect(collection.getOwnedThemeIds()).toEqual(['forest']);
        expect(collection.getSummary()).toEqual({ owned: 1, total: 62, newCount: 0 });
        THEME_REGISTRY.forEach(({ id }) => expect(collection.getThemeStatus(id).requirement.type)
            .not.toBe('unavailable'));
        expect(collection.getThemeStatus('cinder-drift')).toMatchObject({
            owned: false, requirement: { type: 'orb', levelId: 1, chapterId: 1 },
        });
    });

    it('grants the played theme once, persists before notification, and records seen state', () => {
        const collection = createCollection();
        const state = new OdysseyStateManager({ levelRegistry: registry });
        const listener = vi.fn(() => {
            expect(JSON.parse(storage.getItem(THEME_COLLECTION_STORAGE_KEY)).grants['cinder-drift']).toBeDefined();
        });
        const unsubscribe = collection.subscribe(listener);
        const receipt = complete(collection, state, 1);
        expect(receipt).toEqual({
            themeIds: ['cinder-drift'], totalOwned: 2, totalThemes: 62, persisted: true, sourceLevelId: 1,
        });
        expect(collection.getThemeStatus('cinder-drift').isNew).toBe(true);
        expect(complete(collection, state, 1).themeIds).toEqual([]);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(collection.markSeen('cinder-drift')).toBe(true);
        expect(createCollection().getThemeStatus('cinder-drift').isNew).toBe(false);
        unsubscribe();
        expect(complete(collection, state, 2).themeIds).toEqual(['crystal-cave']);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('grants all 62 themes over the real 59-orb campaign with no duplicates', () => {
        const collection = createCollection();
        const state = new OdysseyStateManager({ levelRegistry: registry });
        const grants = [];
        const receipts = [];
        for (let levelId = 1; levelId <= 59; levelId++) {
            const receipt = complete(collection, state, levelId);
            receipts.push(receipt);
            grants.push(...receipt.themeIds);
        }
        expect(grants).toHaveLength(61);
        expect(new Set(grants).size).toBe(61);
        expect(receipts[11].themeIds).toEqual([]); // Forest was the starter.
        expect(receipts[16].themeIds).toContain('summer');
        expect(receipts[18].themeIds).not.toContain('summer');
        expect(receipts[29].themeIds).toContain('vesper-chrysalis');
        expect(receipts[58].themeIds).toEqual(['neon-district', 'parhelion', 'serenity-warp']);
        expect(createCollection().getSummary().owned).toBe(62);
    });

    it('requires every chapter orb rather than only its last orb for the bonus', () => {
        const collection = createCollection();
        const state = new OdysseyStateManager({ levelRegistry: registry });
        expect(complete(collection, state, 5).themeIds).toEqual(['bioluminescence']);
        [1, 2, 3].forEach((id) => complete(collection, state, id));
        expect(collection.isUnlocked('void-ember')).toBe(false);
        expect(complete(collection, state, 4).themeIds).toEqual(['pyrestorm', 'void-ember']);
    });

    it('uses the composed orb 22 Aurora theme and rejects a mismatched reward request', () => {
        const collection = createCollection();
        const state = new OdysseyStateManager({ levelRegistry: registry });
        const completion = state.completeLevel(22, success);
        expect(completion.themeId).toBe('aurora');
        expect(collection.awardCompletion({
            levelId: 22, themeId: 'himalayan-peak', progressPersisted: true,
        }).persisted).toBe(false);
        expect(collection.awardCompletion({ levelId: 22, themeId: 'aurora', progressPersisted: true }).themeIds)
            .toEqual(['aurora']);
    });

    it('migrates v1 completion IDs before quiet backfill and ignores unlocked-only/corrupt entries', () => {
        storage.setItem(ODYSSEY_PROGRESS_STORAGE_KEY, JSON.stringify({
            version: 1,
            unlockedLevels: Array.from({ length: 59 }, (_, index) => index + 1),
            completedLevels: {
                42: { stars: 1 }, 1: null, 2: { stars: '3' }, 3: { stars: 99 },
            },
        }));
        const collection = createCollection();
        expect(collection.getOwnedThemeIds()).toEqual(['forest', 'stellar-velocity']);
        expect(collection.getSummary().newCount).toBe(0);
        expect(collection.exportData().grants['stellar-velocity'].levelId).toBe(46);
        expect(storage.getItem(ODYSSEY_PROGRESS_STORAGE_KEY)).toContain('"version":1');
    });

    it('does not grant failed or unpersisted attempts and preserves the old completion return shape', () => {
        const collection = createCollection();
        const state = new OdysseyStateManager({ levelRegistry: registry });
        state.recordAttempt(1);
        expect(collection.awardCompletion({ levelId: 1, themeId: 'cinder-drift', progressPersisted: true })
            .persisted).toBe(false);
        storage.setItem.mockImplementation(() => { throw new Error('disk full'); });
        const result = state.completeLevel(1, success);
        expect(result).toMatchObject({ stars: 1, bestScore: 1000, themeId: 'cinder-drift' });
        expect(result.persisted).toBe(false);
        expect(Object.keys(result)).not.toContain('persisted');
        expect(collection.awardCompletion({ levelId: 1, themeId: 'cinder-drift', progressPersisted: false })
            .themeIds).toEqual([]);
        expect(collection.getOwnedThemeIds()).toEqual(['forest']);
    });

    it('saves completion once and recovers an interrupted collection write on restart without celebration', () => {
        const collection = createCollection();
        const state = new OdysseyStateManager({ levelRegistry: registry });
        storage.setItem.mockClear();
        const originalWrite = storage.setItem.getMockImplementation();
        storage.setItem.mockImplementation((key, value) => {
            if (key === THEME_COLLECTION_STORAGE_KEY) throw new Error('quota');
            originalWrite(key, value);
        });
        const listener = vi.fn();
        collection.subscribe(listener);
        const receipt = complete(collection, state, 1);
        expect(storage.setItem.mock.calls.filter(([key]) => key === ODYSSEY_PROGRESS_STORAGE_KEY)).toHaveLength(1);
        expect(receipt.persisted).toBe(false);
        expect(receipt.themeIds).toEqual([]);
        expect(listener).not.toHaveBeenCalled();
        expect(collection.isUnlocked('cinder-drift')).toBe(false);
        storage.setItem.mockImplementation(originalWrite);
        const recovered = createCollection();
        expect(recovered.isUnlocked('cinder-drift')).toBe(true);
        expect(recovered.getSummary().newCount).toBe(0);
    });

    it('preserves collection when Odyssey is reset and resolves retired IDs', () => {
        const collection = createCollection();
        const state = new OdysseyStateManager({ levelRegistry: registry });
        complete(collection, state, 4);
        state.reset();
        const reloaded = createCollection();
        expect(reloaded.isUnlocked('pyrestorm-v2')).toBe(true);
        expect(reloaded.getOwnedThemeIds()).toEqual(['forest', 'pyrestorm']);
    });

    it('preserves unsupported/corrupt collection documents and rejects future Odyssey schemas', () => {
        storage.setItem(THEME_COLLECTION_STORAGE_KEY, '{"version":9,"future":"preserve"}');
        const collection = createCollection();
        const state = new OdysseyStateManager({ levelRegistry: registry });
        expect(complete(collection, state, 1).persisted).toBe(false);
        expect(storage.getItem(THEME_COLLECTION_STORAGE_KEY)).toContain('"version":9');
        expect(storage.getItem(THEME_COLLECTION_RECOVERY_STORAGE_KEY)).toBeNull();
        expect(collection.getPersistenceStatus()).toEqual({
            status: 'unsupported-version', readOnly: true, canRetry: false,
        });
        expect(collection.reconcileFromOdyssey({ version: 9, completedLevels: { 1: { stars: 1 } } })
            .persisted).toBe(false);
    });

    it('backs up malformed JSON before rebuilding saved orb ownership without a ceremony', () => {
        const corrupt = '{"version":1,"grants": interrupted';
        storage.setItem(THEME_COLLECTION_STORAGE_KEY, corrupt);
        storage.setItem(ODYSSEY_PROGRESS_STORAGE_KEY, JSON.stringify({
            version: 2, completedLevels: { 1: { stars: 1 } },
        }));
        storage.setItem.mockClear();
        const collection = createCollection();
        expect(storage.getItem(THEME_COLLECTION_RECOVERY_STORAGE_KEY)).toBe(corrupt);
        expect(storage.setItem.mock.calls[0]).toEqual([THEME_COLLECTION_RECOVERY_STORAGE_KEY, corrupt]);
        const repaired = JSON.parse(storage.getItem(THEME_COLLECTION_STORAGE_KEY));
        expect(repaired.grants['cinder-drift']).toMatchObject({ source: 'odyssey', levelId: 1 });
        expect(collection.getSummary()).toMatchObject({ owned: 2, newCount: 0 });
        expect(collection.getPersistenceStatus().status).toBe('ready');
    });

    it('keeps fresh profiles distinct from an empty corrupted document and retries a transient read failure', () => {
        const fresh = createCollection();
        expect(storage.getItem(THEME_COLLECTION_RECOVERY_STORAGE_KEY)).toBeNull();
        expect(storage.getItem(THEME_COLLECTION_STORAGE_KEY)).toBeNull();
        expect(fresh.getPersistenceStatus().status).toBe('ready');
        storage.setItem(THEME_COLLECTION_STORAGE_KEY, '');
        const recovered = createCollection();
        expect(storage.getItem(THEME_COLLECTION_RECOVERY_STORAGE_KEY)).toBe('');
        expect(recovered.getOwnedThemeIds()).toEqual(['forest']);
        storage.removeItem(THEME_COLLECTION_STORAGE_KEY);
        storage.getItem.mockImplementationOnce(() => { throw new Error('temporary denial'); });
        const retrying = createCollection();
        expect(retrying.reconcileFromOdyssey().persisted).toBe(true);
        expect(retrying.getPersistenceStatus().status).toBe('ready');
    });

    it('preserves corrupt bytes when backup fails and retries quietly when the collection is reopened', () => {
        const corrupt = '{corrupt';
        storage.setItem(THEME_COLLECTION_STORAGE_KEY, corrupt);
        storage.setItem(ODYSSEY_PROGRESS_STORAGE_KEY, JSON.stringify({
            version: 2, completedLevels: { 1: { stars: 1 } },
        }));
        const originalWrite = storage.setItem.getMockImplementation();
        storage.setItem.mockImplementation((key, value) => {
            if (key === THEME_COLLECTION_RECOVERY_STORAGE_KEY) throw new Error('backup quota');
            originalWrite(key, value);
        });
        const collection = createCollection();
        expect(collection.getPersistenceStatus().status).toBe('backup-failed');
        expect(storage.getItem(THEME_COLLECTION_STORAGE_KEY)).toBe(corrupt);
        expect(collection.isUnlocked('cinder-drift')).toBe(false);
        const listener = vi.fn();
        collection.subscribe(listener);
        expect(collection.reconcileFromOdyssey(undefined, { silent: true }).persisted).toBe(false);
        expect(listener).not.toHaveBeenCalled();
        storage.setItem.mockImplementation(originalWrite);
        expect(collection.reconcileFromOdyssey(undefined, { silent: true }).persisted).toBe(true);
        expect(storage.getItem(THEME_COLLECTION_RECOVERY_STORAGE_KEY)).toBe(corrupt);
        expect(collection.isUnlocked('cinder-drift')).toBe(true);
        expect(collection.getSummary().newCount).toBe(0);
        expect(listener.mock.calls.map(([event]) => event.source)).toEqual(['reconcile']);
    });

    it('keeps the original corruption when replacement fails after a successful backup', () => {
        const corrupt = '{bad';
        storage.setItem(THEME_COLLECTION_STORAGE_KEY, corrupt);
        const originalWrite = storage.setItem.getMockImplementation();
        storage.setItem.mockImplementation((key, value) => {
            if (key === THEME_COLLECTION_STORAGE_KEY) throw new Error('replacement quota');
            originalWrite(key, value);
        });
        const collection = createCollection();
        expect(storage.getItem(THEME_COLLECTION_RECOVERY_STORAGE_KEY)).toBe(corrupt);
        expect(storage.getItem(THEME_COLLECTION_STORAGE_KEY)).toBe(corrupt);
        expect(collection.getPersistenceStatus().status).toBe('write-failed');
        storage.setItem.mockImplementation(originalWrite);
        expect(collection.reconcileFromOdyssey().persisted).toBe(true);
        expect(JSON.parse(storage.getItem(THEME_COLLECTION_STORAGE_KEY)).grants).toEqual({
            forest: { source: 'starter' },
        });
        expect(collection.getPersistenceStatus().status).toBe('ready');
    });

    it('retries a two-document write failure on the same instance without a second award ceremony', () => {
        const collection = createCollection();
        const state = new OdysseyStateManager({ levelRegistry: registry });
        const originalWrite = storage.setItem.getMockImplementation();
        storage.setItem.mockImplementation((key, value) => {
            if (key === THEME_COLLECTION_STORAGE_KEY) throw new Error('collection quota');
            originalWrite(key, value);
        });
        expect(complete(collection, state, 1).persisted).toBe(false);
        expect(collection.getPersistenceStatus().status).toBe('write-failed');
        const listener = vi.fn();
        collection.subscribe(listener);
        storage.setItem.mockImplementation(originalWrite);
        expect(collection.reconcileFromOdyssey().persisted).toBe(true);
        expect(collection.getSummary()).toMatchObject({ owned: 2, newCount: 0 });
        expect(listener.mock.calls.map(([event]) => event.source)).toEqual(['reconcile']);
        expect(collection.reconcileFromOdyssey().themeIds).toEqual([]);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('puts the just-played theme first when an earlier failed grant also recovers', () => {
        const collection = createCollection();
        const state = new OdysseyStateManager({ levelRegistry: registry });
        const originalWrite = storage.setItem.getMockImplementation();
        storage.setItem.mockImplementation((key, value) => {
            if (key === THEME_COLLECTION_STORAGE_KEY) throw new Error('collection quota');
            originalWrite(key, value);
        });
        expect(complete(collection, state, 1).persisted).toBe(false);
        storage.setItem.mockImplementation(originalWrite);
        expect(complete(collection, state, 2).themeIds).toEqual(['crystal-cave', 'cinder-drift']);
    });

    it('merges ownership and seen state commutatively/idempotently without revoking either side', () => {
        const left = createThemeCollectionData();
        const right = createThemeCollectionData();
        left.grants.pyrestorm = { source: 'odyssey', levelId: 4 };
        left.updatedAt = 99999;
        right.grants.aurora = { source: 'odyssey', levelId: 22 };
        right.seenThemeIds.push('aurora');
        right.updatedAt = 1;
        const union = mergeThemeCollections(left, right, resolveThemeId);
        expect(union).toEqual(mergeThemeCollections(right, left, resolveThemeId));
        expect(mergeThemeCollections(union, left, resolveThemeId)).toEqual(union);
        expect(union.grants).toHaveProperty('pyrestorm');
        expect(union.grants).toHaveProperty('aurora');
        expect(union.seenThemeIds).toContain('aurora');
        expect(union.grants.forest).toEqual({ source: 'starter' });
    });
});

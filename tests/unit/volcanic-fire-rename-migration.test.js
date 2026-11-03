import {
    afterEach, beforeEach, describe, expect, it,
} from 'vitest';
import { existsSync } from 'node:fs';
import { SettingsManager } from '../../src/ui/settings.js';
import {
    BREATH_WORLDS, RENAMED_BREATH_WORLDS, breathPosterUrl, getBreathWorld, resolveBreathWorldId,
} from '../../src/ui/effects/breathing/breath-catalogue.js';
import {
    BREATH_COLLECTION_VERSION, normalizeBreathCollection,
} from '../../src/ui/effects/breathing/breath-collection.js';
import { readBreathPractice } from '../../src/ui/effects/breathing/breath-practice.js';

const OLD_ID = Object.keys(RENAMED_BREATH_WORLDS)[0];
const NEW_ID = 'volcanic-fire';

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => { store.clear(); },
    };
}

describe('Volcanic Fire took its own id: what a player saved under the old one carries over', () => {
    beforeEach(() => {
        globalThis.localStorage = createLocalStorageMock();
    });
    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('publishes the world under one id, its poster under that name, and resolves the old id to it', () => {
        expect(RENAMED_BREATH_WORLDS).toEqual({ [OLD_ID]: NEW_ID });
        expect(BREATH_WORLDS.map((world) => world.id)).toContain(NEW_ID);
        expect(BREATH_WORLDS.map((world) => world.id)).not.toContain(OLD_ID);
        expect(resolveBreathWorldId(OLD_ID)).toBe(NEW_ID);
        expect(resolveBreathWorldId('calm-sleep')).toBe('calm-sleep');
        expect(getBreathWorld(OLD_ID)).toBe(getBreathWorld(NEW_ID));
        expect(getBreathWorld(NEW_ID).name).toBe('Volcanic Fire');
        expect(breathPosterUrl(NEW_ID)).toContain(`${NEW_ID}.webp`);
        expect(existsSync(new URL(`../../public/assets/breathing/${NEW_ID}.webp`, import.meta.url))).toBe(true);
    });

    it('heals a saved breathing world in the settings and saves the healed value', () => {
        localStorage.setItem('serenityBlocksSettings', JSON.stringify({ breathingTechnique: OLD_ID }));
        const loaded = new SettingsManager().load();
        expect(loaded.breathingTechnique).toBe(NEW_ID);
        expect(JSON.parse(localStorage.getItem('serenityBlocksSettings')).breathingTechnique).toBe(NEW_ID);
    });

    it('keeps an opened and seen world under its new id in the breath collection', () => {
        const known = { worlds: new Set(BREATH_WORLDS.map((world) => world.id)), sessions: new Set(['FIRST']) };
        const data = normalizeBreathCollection({
            version: BREATH_COLLECTION_VERSION,
            worlds: { [OLD_ID]: 'odyssey', 'calm-sleep': 'starter' },
            sessions: {},
            seen: { worlds: [OLD_ID, 'calm-sleep'], sessions: [] },
        }, known);
        expect(data.worlds).toEqual({ [NEW_ID]: 'odyssey', 'calm-sleep': 'starter' });
        expect(data.seen.worlds).toEqual([NEW_ID, 'calm-sleep']);
    });

    it('adds practice time saved under the old id to the world', () => {
        localStorage.setItem('serenity.breathPractice', JSON.stringify({ v: 1, worlds: { [OLD_ID]: 600, [NEW_ID]: 120 } }));
        expect(readBreathPractice(localStorage)).toEqual({ v: 1, seconds: 720, worlds: { [NEW_ID]: 720 } });
    });
});

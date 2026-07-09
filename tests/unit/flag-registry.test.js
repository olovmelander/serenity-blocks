import { describe, expect, it } from 'vitest';
import { FLAG_REGISTRY, readFlag } from '../../src/core/flags.js';

const VALID_KINDS = new Set(['permanent-ops', 'refactor']);
const VALID_READERS = new Set(['flags', 'local']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TODAY = new Date().toISOString().slice(0, 10);

describe('feature flag registry governance', () => {
    it('declares unique, documented flags with valid kinds and readers', () => {
        const names = new Set();

        for (const flag of FLAG_REGISTRY) {
            expect(flag.name).toMatch(/^[A-Za-z][A-Za-z0-9_.-]*$/);
            expect(names.has(flag.name)).toBe(false);
            names.add(flag.name);

            expect(Object.prototype.hasOwnProperty.call(flag, 'default')).toBe(true);
            expect(typeof flag.purpose).toBe('string');
            expect(flag.purpose.trim().length).toBeGreaterThan(12);
            expect(VALID_KINDS.has(flag.kind)).toBe(true);
            expect(VALID_READERS.has(flag.reader)).toBe(true);
        }
    });

    it('requires every refactor flag to have an expiry or graduation bar', () => {
        const refactorFlags = FLAG_REGISTRY.filter((flag) => flag.kind === 'refactor');
        expect(refactorFlags.length).toBeGreaterThan(0);

        for (const flag of refactorFlags) {
            const hasExpiry = typeof flag.expiry === 'string' && flag.expiry.trim().length > 0;
            const hasGraduationBar = typeof flag.graduationBar === 'string'
                && flag.graduationBar.trim().length > 0;

            expect(hasExpiry || hasGraduationBar).toBe(true);

            if (hasExpiry) {
                expect(flag.expiry).toMatch(ISO_DATE);
                expect(flag.expiry >= TODAY).toBe(true);
            }
        }
    });

    it('caps active dated refactor flags at two', () => {
        const datedRefactorFlags = FLAG_REGISTRY.filter((flag) => (
            flag.kind === 'refactor'
            && typeof flag.expiry === 'string'
            && flag.expiry.trim().length > 0
        ));

        expect(datedRefactorFlags.length).toBeLessThanOrEqual(2);
    });

    it('keeps browser flag precedence centralized in readFlag', () => {
        const originalWindow = globalThis.window;
        const getItemCalls = [];

        globalThis.window = {
            location: { search: '?simTickNetcode=1&lockEvents=0' },
            localStorage: {
                getItem(key) {
                    getItemCalls.push(key);
                    return key === 'serenity.adaptiveInputJitter' ? '1' : null;
                },
            },
        };

        try {
            expect(readFlag('simTickNetcode', false)).toBe(true);
            expect(readFlag('lockEvents', true)).toBe(false);
            expect(readFlag('adaptiveInputJitter', false)).toBe(true);
            expect(readFlag('missingFlag', true)).toBe(true);
            expect(getItemCalls).toContain('serenity.adaptiveInputJitter');
        } finally {
            globalThis.window = originalWindow;
        }
    });
});

/**
 * Grainfields — the playground effect's controls in the URL parameter reference.
 *
 * The reference documents every control the effect reads, under the name it reads it by, and
 * nothing else; the effect's header documents each of them too. (The effect itself is mounted by
 * its own tests; this file only holds the reference to the source.)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAYGROUND_URL_PARAMETERS } from '../../src/ui/url-parameters/playground-parameters.js';
import { THEME_URL_PARAMETERS } from '../../src/ui/url-parameters/theme-parameters.js';

const FILE = 'src/playground/effects/grainfields.effect.js';
const SCOPE = 'playground.html — grainfields';
const source = readFileSync(new URL(`../../${FILE}`, import.meta.url), 'utf8');
const header = source.slice(source.indexOf('/**'), source.indexOf('*/', source.indexOf('/**')));
/** Every URL parameter the effect reads, by the name it reads it under. */
const reads = [...new Set([
    ...[...source.matchAll(/\bparams\.(?:get|has)\(\s*'([^']+)'\s*\)/g)].map((match) => match[1]),
    ...[...source.matchAll(/\bnum\(\s*params\s*,\s*'([^']+)'/g)].map((match) => match[1]),
])].sort();

describe('Grainfields playground controls', () => {
    it('documents in its header every control it reads', () => {
        expect(reads.length).toBeGreaterThan(10);
        expect(reads.filter((name) => !header.includes(`${name}=`))).toEqual([]);
    });

    it('is listed in the URL parameter reference with exactly the controls it reads', () => {
        const entries = PLAYGROUND_URL_PARAMETERS
            .filter((entry) => entry.scope === SCOPE && entry.sources.includes(FILE));
        expect(entries.map((entry) => entry.name).sort()).toEqual(reads);
        // Nothing else claims the scope.
        expect(PLAYGROUND_URL_PARAMETERS.filter((entry) => entry.scope === SCOPE)).toHaveLength(entries.length);
        entries.forEach((entry) => {
            expect(entry.example, entry.name).toMatch(new RegExp(`^${entry.name}=`));
            expect(entry.description.length, entry.name).toBeGreaterThan(10);
            // The world on the horizon is Lapporten.
            expect(`${entry.description} ${entry.values}`, entry.name).not.toMatch(/volcano/i);
        });
    });

    it('lists the same part names for the effect as for the theme\'s capture flag', () => {
        const parts = PLAYGROUND_URL_PARAMETERS.find((entry) => entry.scope === SCOPE && entry.name === 'parts');
        const flag = THEME_URL_PARAMETERS.find((entry) => entry.name === 'grainfieldsParts');
        const names = (text) => text.replace(/^[^:]*(?:of|:)\s*/, '').replace(/\.$/, '').split(',')
            .map((name) => name.trim())
            .sort();
        expect(names(parts.values)).toEqual(names(flag.values));
    });
});

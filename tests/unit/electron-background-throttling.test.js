import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ENTRYPOINTS = [
    '../../electron/main.js',
    '../../electron/main-minimal.js',
];

describe('Electron fixed-simulation timer policy', () => {
    it.each(ENTRYPOINTS)('%s disables BrowserWindow background throttling', (entrypoint) => {
        const source = readFileSync(new URL(entrypoint, import.meta.url), 'utf8');
        const settings = source.match(/\bbackgroundThrottling\s*:\s*false\b/g) || [];

        expect(settings).toHaveLength(1);
    });
});

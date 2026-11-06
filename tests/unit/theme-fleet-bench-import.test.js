import { describe, expect, it, vi } from 'vitest';

// Even on a developer machine with Electron installed, report helpers must not
// load the native launcher (which tries a download when postinstall was skipped).
vi.mock('electron', () => {
    throw new Error('Electron must only be loaded when a benchmark worker is launched');
});

describe('theme fleet report helpers', () => {
    it('can be imported and used without loading Electron', async () => {
        const { buildTable } = await import('../../scripts/theme-fleet-bench.mjs');
        expect(buildTable([], { budgetMs: 1000 / 60 })).toContain('Frame budget 16.67 ms');
    });
});

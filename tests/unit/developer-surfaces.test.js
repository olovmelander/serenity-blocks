import { afterEach, describe, expect, it, vi } from 'vitest';
import { developerSurfacesEnabled } from '../../src/ui/developer-surfaces.js';

describe('Settings developer surfaces (audit R-07 step 7)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('are on in a dev build', () => {
        vi.stubEnv('DEV', true);
        vi.stubGlobal('window', {});
        expect(developerSurfacesEnabled()).toBe(true);
    });

    it('are off in a release build: web, or desktop without diagnostics', () => {
        vi.stubEnv('DEV', false);
        vi.stubGlobal('window', {});
        expect(developerSurfacesEnabled()).toBe(false);
        vi.stubGlobal('window', { electronAPI: { diagnosticsEnabled: false } });
        expect(developerSurfacesEnabled()).toBe(false);
    });

    it('are on in a desktop build started with diagnostics', () => {
        vi.stubEnv('DEV', false);
        vi.stubGlobal('window', { electronAPI: { diagnosticsEnabled: true } });
        expect(developerSurfacesEnabled()).toBe(true);
    });
});

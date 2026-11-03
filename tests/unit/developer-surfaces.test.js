import { afterEach, describe, expect, it, vi } from 'vitest';
import { developerSurfacesEnabled, packagedReleaseLocked } from '../../src/ui/developer-surfaces.js';
import { isDevelopmentCollectionUnlocked } from '../../src/themes/theme-collection.js';
import { isDevelopmentBreathUnlocked } from '../../src/ui/effects/breathing/breath-collection-store.js';

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

    it('lock the development overrides in a shipped desktop build without diagnostics', () => {
        vi.stubGlobal('window', { electronAPI: { isPackaged: true, diagnosticsEnabled: false } });
        expect(packagedReleaseLocked()).toBe(true);
        expect(isDevelopmentCollectionUnlocked('?unlockAll=1')).toBe(false);
        expect(isDevelopmentBreathUnlocked('?unlockAll=1')).toBe(false);
        // Diagnostics runs, dev runs and browser previews keep unlockAll for harnesses.
        vi.stubGlobal('window', { electronAPI: { isPackaged: true, diagnosticsEnabled: true } });
        expect(packagedReleaseLocked()).toBe(false);
        expect(isDevelopmentCollectionUnlocked('?unlockAll=1')).toBe(true);
        vi.stubGlobal('window', {});
        expect(packagedReleaseLocked()).toBe(false);
        expect(isDevelopmentBreathUnlocked('?unlockAll=1')).toBe(true);
    });

    it('are on in a desktop build started with diagnostics', () => {
        vi.stubEnv('DEV', false);
        vi.stubGlobal('window', { electronAPI: { diagnosticsEnabled: true } });
        expect(developerSurfacesEnabled()).toBe(true);
    });
});

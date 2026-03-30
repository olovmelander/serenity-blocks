import { describe, expect, it } from 'vitest';
import { resolveThemeStartupPolicy } from '../../src/themes/theme-manager.js';
import { getThemeMeta } from '../../src/themes/theme-registry.js';

describe('theme startup policy', () => {
    it('keeps packaged Windows startup on a single cached theme until startup is complete', () => {
        const runtimeConfig = {
            platform: 'win32',
            isPackaged: true,
            windowsProfile: 'webParity',
            safeMode: false,
        };

        expect(resolveThemeStartupPolicy(runtimeConfig, {
            startupComplete: false,
        })).toEqual({
            maxCachedThemes: 1,
            deferAdjacentThemePreload: true,
            preserveSuspendedRuntime: false,
        });

        expect(resolveThemeStartupPolicy(runtimeConfig, {
            startupComplete: true,
        })).toEqual({
            maxCachedThemes: 2,
            deferAdjacentThemePreload: false,
            preserveSuspendedRuntime: true,
        });
    });

    it('keeps safe mode in the strict startup policy even after startup completes', () => {
        const runtimeConfig = {
            platform: 'win32',
            isPackaged: true,
            windowsProfile: 'baseline',
            safeMode: true,
        };

        expect(resolveThemeStartupPolicy(runtimeConfig, {
            startupComplete: true,
        })).toEqual({
            maxCachedThemes: 1,
            deferAdjacentThemePreload: true,
            preserveSuspendedRuntime: false,
        });
    });

    it('exposes declarative startup metadata for theme registry entries', () => {
        expect(getThemeMeta('forest')).toMatchObject({
            performanceClass: 'light',
            startupEligible: true,
        });
        expect(getThemeMeta('black-hole')).toMatchObject({
            performanceClass: 'heavy',
            startupEligible: false,
        });
    });
});

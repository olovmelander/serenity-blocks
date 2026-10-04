import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import WolfhourTheme from '../../src/themes/wolfhour/wolfhour-theme.js';
import ChromadelicHighwayTheme from '../../src/themes/chromadelic-highway/chromadelic-highway-theme.js';

beforeEach(() => {
    vi.stubGlobal('window', { location: { search: '' }, removeEventListener: vi.fn() });
    vi.stubGlobal('document', { getElementById: () => null, querySelectorAll: () => [] });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const themes = [
    ['Wolfhour', WolfhourTheme, 'resetRuntimeScene'],
    ['Chromadelic Highway', ChromadelicHighwayTheme, 'disposeRendererResources'],
];
describe('retired node renderer callback contract', () => {
    it.each(themes)('allows a queued Three backend loss after %s retirement', (name, Theme, retireMethod) => {
        const theme = new Theme();
        const previousCallback = vi.fn();
        const retired = { onDeviceLost: previousCallback, domElement: { remove: vi.fn() } };
        theme.renderer = retired;
        vi.spyOn(theme, 'disposeRenderer').mockImplementation(() => {});
        theme[retireMethod]();
        expect(theme.renderer).toBeNull();
        expect(() => retired.onDeviceLost({ reason: 'destroyed', api: 'WebGL' })).not.toThrow();
        expect(previousCallback).not.toHaveBeenCalled();
    });
});

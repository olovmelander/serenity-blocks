import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { isOdysseyAAADebugEnabled } from './odyssey-debug-overlay.js';

function stubSearch(search) {
    vi.stubGlobal('window', {
        location: { search },
    });
}

describe('isOdysseyAAADebugEnabled', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('enables the diagnostics overlay for odysseyAAA captures by default', () => {
        stubSearch('?odysseyAAA=1');

        expect(isOdysseyAAADebugEnabled()).toBe(true);
    });

    it('lets capture harnesses keep odysseyAAA while hiding the overlay', () => {
        stubSearch('?odysseyAAA=1&odysseyOverlay=0');

        expect(isOdysseyAAADebugEnabled()).toBe(false);
    });
});

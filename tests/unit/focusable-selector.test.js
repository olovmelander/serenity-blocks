import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { FOCUSABLE_SELECTOR, SpatialNavigation } from '../../src/ui/spatial-navigation.js';
import { getSheetFocusables } from '../../src/ui/sheet-input.js';

afterEach(() => vi.unstubAllGlobals());

describe('focusable selector', () => {
    it('counts links, not the SVG <use href> icons inside buttons', () => {
        const parts = FOCUSABLE_SELECTOR.split(',').map((part) => part.trim());
        expect(parts).toContain('a[href]');
        // A bare [href] matched each button's <use href> icon, which takes no focus: the
        // D-pad picked it as the nearest target and stayed on the pause sheet's Resume.
        expect(parts).not.toContain('[href]');
    });

    it('is the one list the D-pad and the sheets\' Tab trap search', () => {
        vi.stubGlobal('window', { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) });
        const seen = [];
        const container = { querySelectorAll: (selector) => { seen.push(selector); return []; } };

        SpatialNavigation.getFocusableElements(container);
        getSheetFocusables(container);

        expect(seen).toEqual([FOCUSABLE_SELECTOR, FOCUSABLE_SELECTOR]);
    });
});

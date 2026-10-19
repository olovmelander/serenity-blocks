import { describe, expect, it } from 'vitest';
import { isOdysseyTheCurrentMode } from '../../src/utils/startup-warm.js';

describe('isOdysseyTheCurrentMode (menu-theme warm stand-down, 2026-10-19)', () => {
    it('is true only while Odyssey is the current mode', () => {
        expect(isOdysseyTheCurrentMode({ getCurrentModeId: () => 'odyssey' })).toBe(true);
        expect(isOdysseyTheCurrentMode({ getCurrentModeId: () => 'single' })).toBe(false);
        expect(isOdysseyTheCurrentMode({ getCurrentModeId: () => null })).toBe(false);
    });

    it('never throws into the boot path', () => {
        expect(isOdysseyTheCurrentMode(null)).toBe(false);
        expect(isOdysseyTheCurrentMode({})).toBe(false);
        expect(isOdysseyTheCurrentMode({ getCurrentModeId: () => { throw new Error('torn down'); } })).toBe(false);
    });
});

import { describe, expect, it } from 'vitest';

import { resolveVesperQuality } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-quality.js';

describe('Vesper Chrysalis quality selection', () => {
    it.each(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'])(
        'honors the shipped %s graphics preference without the legacy setting',
        (quality) => {
            expect(resolveVesperQuality(new URLSearchParams(), { effectQuality: quality })).toBe(quality);
        },
    );

    it('prefers the current graphics setting over a stale legacy preference', () => {
        expect(resolveVesperQuality(undefined, {
            effectQuality: 'Minimal', graphicsQuality: 'Extreme',
        })).toBe('Minimal');
    });

    it('preserves an explicit playground override over either saved preference', () => {
        expect(resolveVesperQuality(new URLSearchParams('quality=Low'), {
            effectQuality: 'Extreme', graphicsQuality: 'High',
        })).toBe('Low');
    });

    it('supports the legacy graphics preference when no current setting exists', () => {
        expect(resolveVesperQuality(undefined, { graphicsQuality: 'Medium' })).toBe('Medium');
    });

    it('ignores empty URL overrides and normalizes the selected preference', () => {
        expect(resolveVesperQuality(new URLSearchParams('quality='), {
            effectQuality: ' minimal ',
        })).toBe('Minimal');
        expect(resolveVesperQuality(new URLSearchParams('quality=eXtReMe'))).toBe('Extreme');
    });

    it('uses the shared High fallback for absent or unsupported preferences', () => {
        expect(resolveVesperQuality()).toBe('High');
        expect(resolveVesperQuality(undefined, { effectQuality: 'Custom' })).toBe('High');
        expect(resolveVesperQuality(new URLSearchParams('quality=unsupported'), {
            effectQuality: 'Minimal',
        })).toBe('High');
    });
});

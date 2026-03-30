import { describe, expect, it } from 'vitest';
import {
    CURSOR_IDLE_FADE_DELAY_MS,
    CURSOR_STATES,
    isCursorInactive,
    mapInlineCursorStyle,
    normalizeCursorSettings,
    resolveCursorPalette,
} from '../../src/ui/components/custom-cursor.js';

describe('custom cursor helpers', () => {
    it('maps supported inline cursor styles to cursor states', () => {
        expect(mapInlineCursorStyle('pointer')).toBe(CURSOR_STATES.INTERACTIVE);
        expect(mapInlineCursorStyle('grab')).toBe(CURSOR_STATES.GRAB);
        expect(mapInlineCursorStyle('grabbing')).toBe(CURSOR_STATES.GRABBING);
        expect(mapInlineCursorStyle('not-allowed')).toBe(CURSOR_STATES.DISABLED);
        expect(mapInlineCursorStyle('text')).toBe(CURSOR_STATES.TEXT);
        expect(mapInlineCursorStyle('auto')).toBeNull();
        expect(mapInlineCursorStyle('')).toBeNull();
    });

    it('normalizes invalid cursor settings back to defaults', () => {
        expect(normalizeCursorSettings({
            customCursorEnabled: 'yes',
            customCursorIntensity: 'maximum',
            customCursorVisibilityPreset: 'huge',
            customCursorReducedMotion: 'maybe',
        })).toEqual({
            customCursorEnabled: true,
            customCursorIntensity: 'standard',
            customCursorVisibilityPreset: 'standard',
            customCursorReducedMotion: 'system',
        });
    });

    it('treats the cursor as inactive only after the idle fade delay elapses', () => {
        expect(isCursorInactive(0, CURSOR_IDLE_FADE_DELAY_MS + 200)).toBe(false);
        expect(isCursorInactive(250, 250 + CURSOR_IDLE_FADE_DELAY_MS - 1)).toBe(false);
        expect(isCursorInactive(250, 250 + CURSOR_IDLE_FADE_DELAY_MS)).toBe(true);
    });

    it('resolves palette data from Odyssey theme presentation colors', () => {
        expect(resolveCursorPalette('cosmic-noir')).toEqual({
            primary: '#5c7dff',
            accent: '#839cff',
            highlight: '#bbc8ff',
            shadow: '#1d2851',
        });
    });
});

import { readFileSync } from 'fs';
import path from 'path';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

import MoonriseSummitTheme from '../../src/themes/moonrise-summit/moonrise-summit-theme.js';
import MoonlitForestTheme from '../../src/themes/moonlit-forest/moonlit-forest-theme.js';

/**
 * Settings > Reduce motion reaches the eight themes that used to read only the system
 * preference (theme and rendering audit 2026-10, recommendation A2).
 *
 * Six of them are built from one template and share the same few lines, so those lines are
 * pinned here and forest's own suite runs the behaviour. moonrise-summit and moonlit-forest
 * read it their own way and are run directly.
 */

const ROOT = path.resolve(__dirname, '../..');
const TEMPLATE_THEMES = ['forest', 'fall', 'summer', 'sakura-twilight', 'verdant-hills', 'golden-forest'];

const source = (id) => readFileSync(path.join(ROOT, `src/themes/${id}/${id}-theme.js`), 'utf8');

function stubWindow({ setting = false, system = false } = {}) {
    const query = { matches: system, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('window', {
        settings: { reducedMotion: setting },
        matchMedia: vi.fn(() => query),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    });
    return query;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('reduced motion: the in-game setting as well as the system preference', () => {
    it.each(TEMPLATE_THEMES)('%s reads both, live, and hears the toggle while parked', (id) => {
        const text = source(id);
        expect(text).toContain('this.reducedMotion = enabledSetting(inGame, false) || motionQuery?.matches === true;');
        // A media-query listener passes its event first: it must not be read as the setting.
        expect(text).toContain("this.registerEventListener(motionQuery, 'change', () => updateMotion());");
        expect(text).not.toContain("this.registerEventListener(motionQuery, 'change', updateMotion);");
        // The settings handler updates it before its "active with a renderer" early return.
        const handler = text.slice(text.indexOf('    handleSettingsChanged(payload) {'));
        const read = handler.indexOf("settingUpdate(payload, 'reducedMotion')");
        const guard = handler.indexOf('if (!this.isActive || !this.renderer) return;');
        expect(read).toBeGreaterThan(-1);
        expect(read).toBeLessThan(guard);
    });

    describe('moonrise-summit', () => {
        function detect(options) {
            const query = stubWindow(options);
            const theme = Object.create(MoonriseSummitTheme.prototype);
            const listeners = new Map();
            theme.registerEventListener = vi.fn((target, type, handler) => listeners.set(type, handler));
            theme.parallaxEnabled = true;
            theme.cameraBreatheEnabled = true;
            theme._detectReducedMotion();
            return { theme, query, listeners };
        }

        it('stills the camera when the system preference is on at start, not only on a change', () => {
            const { theme } = detect({ system: true });
            expect(theme._reducedMotion).toBe(true);
            expect(theme.cameraBreatheEnabled).toBe(false);
            expect(theme.parallaxEnabled).toBe(false);
        });

        it('follows the in-game toggle', () => {
            const { theme, listeners } = detect();
            expect(theme.cameraBreatheEnabled).toBe(true);
            listeners.get('settingsChanged')({ detail: { reducedMotion: true } });
            expect(theme.cameraBreatheEnabled).toBe(false);
            expect(theme.parallaxEnabled).toBe(false);
            // Other settings leave it alone.
            listeners.get('settingsChanged')({ detail: { effectQuality: 'High' } });
            expect(theme.cameraBreatheEnabled).toBe(false);
            listeners.get('settingsChanged')({ detail: { reducedMotion: false } });
            expect(theme.cameraBreatheEnabled).toBe(true);
        });

        it('follows the system preference when it changes', () => {
            const { theme, query } = detect();
            query.matches = true;
            query.addEventListener.mock.calls[0][1]({ matches: true });
            expect(theme._reducedMotion).toBe(true);
            expect(theme.cameraBreatheEnabled).toBe(false);
        });
    });

    describe('moonlit-forest', () => {
        const intensity = (options) => {
            stubWindow(options);
            return Object.create(MoonlitForestTheme.prototype).getReactiveIntensity();
        };

        it('damps event pulses for either input', () => {
            expect(intensity()).toBe(1);
            expect(intensity({ setting: true })).toBe(0.45);
            expect(intensity({ system: true })).toBe(0.45);
        });
    });
});

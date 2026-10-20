import { readFileSync } from 'fs';
import path from 'path';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

import SunfallTheme from '../../src/themes/sunfall/sunfall-theme.js';
import SpringTheme from '../../src/themes/spring/spring-theme.js';

/**
 * Settings > Reduce motion reaches the eight themes that used to read only the system
 * preference (theme and rendering audit 2026-10, recommendation A2).
 *
 * Six of them are built from one template and share the same few lines, so those lines are
 * pinned here and forest's own suite runs the behaviour. The seventh was retired when Sunfall
 * took its place (2026-10-20), and the eighth was retired when Spring took its place
 * (2026-10-18); both adapters read both inputs in their reaction settings and are run directly.
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

    describe('sunfall', () => {
        const reduced = (options) => {
            stubWindow(options);
            const theme = Object.create(SunfallTheme.prototype);
            theme.applyReactionSettings(null);
            return theme.reducedMotion;
        };

        it('reduces motion for either input', () => {
            expect(reduced()).toBe(false);
            expect(reduced({ setting: true })).toBe(true);
            expect(reduced({ system: true })).toBe(true);
        });
    });

    describe('spring', () => {
        const reduced = (options) => {
            stubWindow(options);
            const theme = Object.create(SpringTheme.prototype);
            theme.applyReactionSettings(null);
            return theme.reducedMotion;
        };

        it('reduces motion for either input', () => {
            expect(reduced()).toBe(false);
            expect(reduced({ setting: true })).toBe(true);
            expect(reduced({ system: true })).toBe(true);
        });
    });
});

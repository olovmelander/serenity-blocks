import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import ChiralGoldTheme from '../../src/themes/chiral-gold/chiral-gold-theme.js';
import { emitCombo, emitLineClear } from '../../src/events/gameplay-events.js';

const themes = [];
function createTheme(quality = 'Low') {
    const theme = new ChiralGoldTheme();
    theme.applyQualityPreset(quality);
    theme.isActive = true;
    theme.camera = new THREE.PerspectiveCamera(64, 1600 / 900, 0.1, 50000);
    theme.camera.position.set(0, 0, 1520);
    theme.camera.updateMatrixWorld();
    theme.random = () => 0.5;
    theme.sculpture = { trigger: vi.fn() };
    vi.spyOn(theme, 'triggerBurst').mockImplementation(() => {});
    theme.setupEventListeners();
    themes.push(theme);
    return theme;
}

beforeEach(() => {
    vi.stubGlobal('window', {
        innerWidth: 1600,
        innerHeight: 900,
        location: { search: '' },
        settings: { backgroundComboEffects: true },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    });
});
afterEach(() => {
    for (const theme of themes.splice(0)) {
        theme.clearEventSubscriptions();
        theme.clearDeferredTimeouts();
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Chiral Gold canonical gameplay event routing', () => {
    it.each(['High', 'Low', 'Minimal'])('pairs the %s canonical combo with an implicit-count clear', (quality) => {
        const theme = createTheme(quality);
        const context = { source: 'odyssey', player: 1, levelId: 5 };
        emitCombo({ comboCount: 8, ...context });
        expect(theme.pendingComboCount).toBe(8);
        expect(theme.pendingComboContext).toEqual(context);
        emitLineClear({ lineCount: 4, clearedRows: [16, 17, 18, 19], ...context });
        const reactions = theme.sculpture.trigger.mock.calls;
        const scale = theme.getChoreographyCaps().eventScale;
        expect(reactions.map(([kind]) => kind)).toEqual(['combo', 'clear-front']);
        expect(reactions[0][1]).toBeCloseTo(1.9 * scale);
        expect(reactions[1][1]).toBeCloseTo(1.91 * scale);
        expect(reactions.every(([, strength]) => strength <= 2.2 * scale)).toBe(true);
        expect(theme.pendingComboCount).toBe(0);
        expect(theme.pendingComboContext).toBeNull();
        expect(theme.triggerBurst.mock.calls.every(([, combo]) => combo === 8)).toBe(true);

        // A subsequent standalone canonical clear must not reuse the consumed combo.
        theme.triggerBurst.mockClear();
        emitLineClear({ lineCount: 1, clearedRows: [19], ...context });
        expect(theme.sculpture.trigger.mock.calls.at(-1)[0]).toBe('clear');
        expect(theme.triggerBurst.mock.calls.every(([, combo]) => combo === 0)).toBe(true);
    });

    it.each([
        { source: 'serenity-interaction', player: 1, levelId: 5 },
        { source: 'odyssey', player: 2, levelId: 5 },
        { source: 'odyssey', player: 1, levelId: 6 },
    ])('preserves an independent clear from a different context: %o', (clearContext) => {
        const theme = createTheme();
        emitCombo({
            comboCount: 6, source: 'odyssey', player: 1, levelId: 5,
        });
        emitLineClear({ lineCount: 4, clearedRows: [16, 17, 18, 19], ...clearContext });
        expect(theme.sculpture.trigger.mock.calls.map(([kind]) => kind)).toEqual(['combo', 'tetris']);
        expect(theme.sculpture.trigger.mock.calls.at(-1)[1]).toBeCloseTo(1.55 * theme.getChoreographyCaps().eventScale);
        expect(theme.triggerBurst.mock.calls.every(([, combo]) => combo === 0)).toBe(true);
        expect(theme.pendingComboCount).toBe(0);
        expect(theme.pendingComboContext).toBeNull();
    });

    it.each([
        {},
        { source: 'odyssey', player: 1, levelId: 5 },
    ])('retains a same-context pending combo across animation frames: %o', (context) => {
        const theme = createTheme();
        emitCombo({ comboCount: 6, ...context });
        theme.time += 1 / 60;
        emitLineClear({ lineCount: 1, clearedRows: [19], ...context });
        expect(theme.sculpture.trigger.mock.calls.map(([kind]) => kind)).toEqual(['combo', 'clear']);
        expect(theme.sculpture.trigger.mock.calls.at(-1)[1]).toBeCloseTo(1.22 * theme.getChoreographyCaps().eventScale);
        expect(theme.triggerBurst.mock.calls.every(([, combo]) => combo === 6)).toBe(true);
        expect(theme.pendingComboCount).toBe(0);
        expect(theme.pendingComboContext).toBeNull();
    });

    it('clears the pending combo context when runtime references are reset', () => {
        const theme = createTheme();
        emitCombo({
            comboCount: 6, source: 'odyssey', player: 1, levelId: 5,
        });
        theme.resetRuntimeReferences();
        expect(theme.pendingComboCount).toBe(0);
        expect(theme.pendingComboContext).toBeNull();
    });

    it('removes canonical event subscriptions when the theme stops listening', () => {
        const theme = createTheme();
        theme.clearEventSubscriptions();
        emitCombo({ comboCount: 8 });
        emitLineClear({ lineCount: 4, clearedRows: [16, 17, 18, 19] });
        expect(theme.sculpture.trigger).not.toHaveBeenCalled();
        expect(theme.pendingComboCount).toBe(0);
    });
});

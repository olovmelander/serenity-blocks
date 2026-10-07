import { describe, expect, it } from 'vitest';
import {
    createDevToolsShortcutState,
    debugKeysEnabled,
    DEVTOOLS_SHORTCUT_DEDUP_WINDOW_MS,
    getDevToolsShortcutIntent,
    isDuplicateDevToolsShortcut,
} from '../../electron/devtools-shortcuts.js';

describe('DevTools shortcut helpers', () => {
    it('maps F12 and Ctrl+Shift+I to the DevTools toggle intent', () => {
        expect(getDevToolsShortcutIntent({
            type: 'keyDown',
            key: 'F12',
        })).toBe('toggle-devtools');

        expect(getDevToolsShortcutIntent({
            type: 'rawKeyDown',
            key: 'I',
            control: true,
            shift: true,
        })).toBe('toggle-devtools');
    });

    it('maps F5 to the reload intent and ignores unrelated keys', () => {
        expect(getDevToolsShortcutIntent({
            type: 'keyDown',
            key: 'F5',
        })).toBe('reload-window');

        expect(getDevToolsShortcutIntent({
            type: 'keyDown',
            key: 'R',
            control: true,
        })).toBeNull();

        expect(getDevToolsShortcutIntent({
            type: 'keyUp',
            key: 'F12',
        })).toBeNull();
    });

    it('dedups consecutive rawKeyDown/keyDown DevTools toggle events inside the dedup window', () => {
        const state = createDevToolsShortcutState();
        const firstIntent = getDevToolsShortcutIntent({
            type: 'rawKeyDown',
            key: 'F12',
        });
        const secondIntent = getDevToolsShortcutIntent({
            type: 'keyDown',
            key: 'F12',
        });

        expect(isDuplicateDevToolsShortcut(state, firstIntent, 1000)).toBe(false);
        expect(isDuplicateDevToolsShortcut(
            state,
            secondIntent,
            1000 + DEVTOOLS_SHORTCUT_DEDUP_WINDOW_MS - 1,
        )).toBe(true);
    });

    it('does not dedup different intents or events outside the dedup window', () => {
        const state = createDevToolsShortcutState();

        expect(isDuplicateDevToolsShortcut(state, 'toggle-devtools', 1000)).toBe(false);
        expect(isDuplicateDevToolsShortcut(state, 'reload-window', 1050)).toBe(false);
        expect(isDuplicateDevToolsShortcut(
            state,
            'reload-window',
            1050 + DEVTOOLS_SHORTCUT_DEDUP_WINDOW_MS + 1,
        )).toBe(false);
    });

    // F12 is Steam's screenshot key, and F5 reloaded a player out of an online match.
    it('keeps the debug keys out of a release build unless diagnostics are on (audit T14)', () => {
        expect(debugKeysEnabled({ isPackaged: false })).toBe(true);
        expect(debugKeysEnabled({ isPackaged: true })).toBe(false);
        expect(debugKeysEnabled({ isPackaged: true, diagnosticsEnabled: true })).toBe(true);
        expect(debugKeysEnabled()).toBe(true);
    });
});

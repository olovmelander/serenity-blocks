import { describe, expect, it } from 'vitest';
import { GAME_PERMISSIONS, isPermissionAllowed } from '../../electron/permission-policy.js';

const GAME_PAGE = 'file:///C:/Games/Serenity%20Blocks/resources/app.asar/dist/index.html?skipIntro=1';
const isGameUrl = (url) => url.startsWith('file:///C:/Games/Serenity%20Blocks/resources/app.asar/dist/');
const allowed = (kind, permission, requestingUrl = GAME_PAGE) => isPermissionAllowed({
    kind, permission, requestingUrl, isGameUrl,
});

describe('Electron permission policy (audit R-07 step 5)', () => {
    it('gives the game page fullscreen, clipboard writing and the screen wake lock', () => {
        GAME_PERMISSIONS.forEach((permission) => {
            expect(allowed('request', permission)).toBe(true);
            expect(allowed('check', permission)).toBe(true);
        });
    });

    it('refuses every other request, even from the game page', () => {
        [
            'media', 'speaker-selection', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'midiSysex',
            'display-capture', 'openExternal', 'pointerLock', 'keyboardLock', 'idle-detection',
            'window-management', 'storage-access', 'automatic-fullscreen', 'unknown',
        ].forEach((permission) => {
            expect(allowed('request', permission)).toBe(false);
        });
    });

    it('answers the audio device checks the sound manager needs, and no other check', () => {
        expect(allowed('check', 'media')).toBe(true);
        expect(allowed('check', 'speaker-selection')).toBe(true);
        ['geolocation', 'notifications', 'clipboard-read', 'hid', 'serial', 'usb', 'background-sync',
            'automatic-fullscreen'].forEach((permission) => {
            expect(allowed('check', permission)).toBe(false);
        });
    });

    it('gives nothing to a page that is not the game, or with no URL', () => {
        ['request', 'check'].forEach((kind) => {
            expect(allowed(kind, 'fullscreen', 'https://example.com/')).toBe(false);
            expect(allowed(kind, 'fullscreen', 'file:///C:/Users/x/evil.html')).toBe(false);
            expect(allowed(kind, 'media', 'https://example.com/')).toBe(false);
            expect(isPermissionAllowed({ kind, permission: 'fullscreen', isGameUrl })).toBe(false);
            expect(allowed(kind, 'fullscreen', null)).toBe(false);
        });
    });
});

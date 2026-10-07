/**
 * The game opens no external links of its own, so a link that reaches the main
 * process came from injected markup or a compromised renderer. Only https on Steam's
 * own hosts may launch the system browser (audit T14).
 */
import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl } from '../../electron/external-links.js';

describe('external links', () => {
    it('opens https links on Steam\'s hosts', () => {
        expect(isAllowedExternalUrl('https://store.steampowered.com/app/480')).toBe(true);
        expect(isAllowedExternalUrl('https://steamcommunity.com/id/someone')).toBe(true);
    });

    it('refuses any other host, scheme or a host dressed up with credentials', () => {
        [
            'https://example.com/',
            'http://store.steampowered.com/',
            'https://store.steampowered.com.evil.test/',
            'https://evil.test/?https://store.steampowered.com',
            'https://store.steampowered.com@evil.test/',
            'https://user:pass@store.steampowered.com/',
            'file:///C:/Windows/System32/calc.exe',
            'javascript:alert(1)', // eslint-disable-line no-script-url -- a refused input, never run
            'steam://run/480',
            'not a url',
            '',
            null,
        ].forEach((url) => expect(isAllowedExternalUrl(url)).toBe(false));
    });
});

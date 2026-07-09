/**
 * Plan §1.4 — the impairment harness must be inert in real sessions.
 *
 * Regression this pins: SteamNetworking constructed
 * NetworkImpairmentHarness(readNetworkImpairmentConfig()) unconditionally, so a
 * stale localStorage 'serenity.netImpair' from a test session silently
 * dropped/delayed real Steam packets in production.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
    resolveImpairmentBootConfig,
    DEFAULT_NETWORK_IMPAIRMENT,
} from '../../src/core/network/network-impairment.js';

const savedWindow = globalThis.window;

function poisonWindow(search = '') {
    globalThis.window = {
        localStorage: {
            getItem: (key) => (key === 'serenity.netImpair' ? 'lossy' : null),
        },
        location: { search },
    };
}

afterEach(() => {
    globalThis.window = savedWindow;
});

describe('impairment boot gate (plan §1.4)', () => {
    it('PROD + poisoned localStorage → inert defaults (the regression trap)', () => {
        poisonWindow();
        const config = resolveImpairmentBootConfig({ mockMode: false, isDev: false, search: '' });
        expect(config.enabled).toBe(false);
        expect(config).toEqual(DEFAULT_NETWORK_IMPAIRMENT);
    });

    it('mock mode honors the live config', () => {
        poisonWindow();
        const config = resolveImpairmentBootConfig({ mockMode: true, isDev: false, search: '' });
        expect(config.enabled).toBe(true); // 'lossy' preset
        expect(config.lossPct).toBe(5);
    });

    it('dev builds honor the live config', () => {
        poisonWindow();
        const config = resolveImpairmentBootConfig({ mockMode: false, isDev: true, search: '' });
        expect(config.enabled).toBe(true);
    });

    it('explicit ?netImpair URL opt-in is honored even in prod', () => {
        poisonWindow('?netImpair=lossy');
        const config = resolveImpairmentBootConfig({
            mockMode: false,
            isDev: false,
            search: '?netImpair=lossy',
        });
        expect(config.enabled).toBe(true);
    });

    it('an unrelated URL param is not an opt-in', () => {
        poisonWindow('?netImpairment_unrelated=x'); // \b guard: netImpair must be a whole param name
        const config = resolveImpairmentBootConfig({
            mockMode: false,
            isDev: false,
            search: '?someFlag=1',
        });
        expect(config.enabled).toBe(false);
    });
});

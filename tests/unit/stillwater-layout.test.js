import { readFileSync } from 'node:fs';
import {
    describe,
    expect,
    it,
} from 'vitest';

import {
    normalizeStillwaterLayoutInput,
    resolveStillwaterLayout,
    STILLWATER_BOARD_SAFE_REGIONS,
    STILLWATER_LAYOUT_IDS,
    STILLWATER_NARROW_ASPECT,
} from '../../src/themes/stillwater/composition/stillwater-layout.js';

const source = readFileSync(
    new URL('../../src/themes/stillwater/composition/stillwater-layout.js', import.meta.url),
    'utf8',
);

describe('Stillwater production layout policy', () => {
    it('gives a valid explicit Stillwater override absolute precedence', () => {
        expect(resolveStillwaterLayout({
            stillwaterLayout: '  DUO ',
            gameMode: 'odyssey',
            isOnlineMultiplayer: true,
            playerCount: 8,
        }).layout).toBe('duo');
        expect(resolveStillwaterLayout({
            stillwaterLayout: 'journey',
            gameMode: 'local-multiplayer',
            playerCount: 4,
        }).layout).toBe('odyssey');
        expect(resolveStillwaterLayout({
            stillwaterLayout: '3',
            gameMode: 'single',
        }).layout).toBe('quad');
    });

    it('resolves Odyssey before either multiplayer policy', () => {
        expect(resolveStillwaterLayout({
            gameMode: 'odyssey',
            localMultiplayer: true,
            onlineMultiplayer: true,
            playerCount: 4,
        }).layout).toBe('odyssey');
        expect(resolveStillwaterLayout({
            isOdyssey: true,
            gameMode: 'online_multiplayer',
            playerCount: 3,
        }).layout).toBe('odyssey');
    });

    it('maps local two-player to duo and local three/four-player to quad', () => {
        expect(resolveStillwaterLayout({
            gameMode: 'local multiplayer',
            numPlayers: '2',
        }).layout).toBe('duo');
        expect(resolveStillwaterLayout({
            isLocalMultiplayer: true,
            playerCount: 3.9,
        }).layout).toBe('quad');
        expect(resolveStillwaterLayout({
            modeId: 'local-mp',
            players: [{}, {}, {}, {}],
        }).layout).toBe('quad');
        expect(resolveStillwaterLayout({
            gameMode: 'local-multiplayer',
            playerCount: 1,
        }).layout).toBe('solo');
    });

    it('keeps online framing count-aware', () => {
        expect(resolveStillwaterLayout({
            gameMode: 'online',
            players: new Set(['a', 'b']),
        }).layout).toBe('duo');
        expect(resolveStillwaterLayout({
            onlineMultiplayer: true,
            participantCount: 3,
        }).layout).toBe('quad');
        expect(resolveStillwaterLayout({
            gameMode: 'networked',
            playerCount: 12,
        }).layout).toBe('quad');
        expect(resolveStillwaterLayout({
            gameMode: 'online-multiplayer',
            playerCount: 1,
        }).layout).toBe('solo');
    });

    it('normalizes invalid and partial inputs without relying on browser state', () => {
        expect(normalizeStillwaterLayoutInput(null)).toEqual({
            override: null,
            gameMode: 'single',
            playerCount: 1,
            isOdyssey: false,
            isLocalMultiplayer: false,
            isOnlineMultiplayer: false,
            aspect: 16 / 9,
            narrow: false,
        });
        expect(resolveStillwaterLayout({
            stillwaterLayout: 'invalid',
            gameMode: 'odyssey',
            playerCount: Number.NaN,
        }).layout).toBe('odyssey');
        expect(source).not.toMatch(/\bwindow\b|\bdocument\b|\bmatchMedia\b/);
    });

    it('applies the exact layout and narrow-camera pullbacks', () => {
        const solo = resolveStillwaterLayout({ stillwaterLayout: 'solo', aspect: 16 / 9 });
        const duo = resolveStillwaterLayout({ stillwaterLayout: 'duo', aspect: 16 / 9 });
        const quad = resolveStillwaterLayout({ stillwaterLayout: 'quad', aspect: 16 / 9 });
        const narrow = resolveStillwaterLayout({
            stillwaterLayout: 'quad',
            aspect: STILLWATER_NARROW_ASPECT - 0.01,
        });

        expect(solo.camera).toMatchObject({
            position: [0, 14.5, 39],
            layoutPullback: 0,
            narrowPullback: 0,
            totalPullback: 0,
        });
        expect(duo.camera).toMatchObject({
            position: [0, 14.5, 42],
            layoutPullback: 3,
            narrowPullback: 0,
            totalPullback: 3,
        });
        expect(quad.camera).toMatchObject({
            position: [0, 14.5, 46],
            layoutPullback: 7,
            narrowPullback: 0,
            totalPullback: 7,
        });
        expect(narrow.camera).toMatchObject({
            position: [0, 14.5, 50],
            layoutPullback: 7,
            narrowPullback: 4,
            totalPullback: 11,
        });
        expect(resolveStillwaterLayout({
            stillwaterLayout: 'solo',
            width: 1680,
            height: 1000,
        }).camera.narrowPullback).toBe(0);
    });

    it('returns the authored normalized board-safe regions for every layout', () => {
        expect(STILLWATER_LAYOUT_IDS).toEqual(['solo', 'duo', 'quad', 'odyssey']);
        expect(STILLWATER_BOARD_SAFE_REGIONS.solo).toEqual([
            {
                x: 0.32, y: 0.09, width: 0.36, height: 0.82,
            },
        ]);
        expect(STILLWATER_BOARD_SAFE_REGIONS.duo).toHaveLength(2);
        expect(STILLWATER_BOARD_SAFE_REGIONS.quad).toHaveLength(4);
        expect(STILLWATER_BOARD_SAFE_REGIONS.odyssey).toEqual([
            {
                x: 0.37, y: 0.08, width: 0.31, height: 0.84,
            },
            {
                x: 0.055,
                y: 0.14,
                width: 0.22,
                height: 0.72,
                role: 'hud-exclusion',
            },
        ]);
        STILLWATER_LAYOUT_IDS.forEach((layout) => {
            const regions = resolveStillwaterLayout({ stillwaterLayout: layout })
                .boardSafeRegions;
            regions.forEach((region) => {
                expect(region.x).toBeGreaterThanOrEqual(0);
                expect(region.y).toBeGreaterThanOrEqual(0);
                expect(region.x + region.width).toBeLessThanOrEqual(1);
                expect(region.y + region.height).toBeLessThanOrEqual(1);
            });
        });
    });

    it('deep-freezes framing and shared safe-region data', () => {
        const result = resolveStillwaterLayout({
            stillwaterLayout: 'duo',
            viewport: { width: 1600, height: 1000 },
        });

        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.camera)).toBe(true);
        expect(Object.isFrozen(result.camera.position)).toBe(true);
        expect(Object.isFrozen(result.boardSafeRegions)).toBe(true);
        expect(Object.isFrozen(result.boardSafeRegions[0])).toBe(true);
        expect(() => {
            result.camera.position[2] = 999;
        }).toThrow(TypeError);
        expect(() => {
            result.boardSafeRegions[0].x = 0;
        }).toThrow(TypeError);
    });
});

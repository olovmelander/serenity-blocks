/**
 * Plan §5.5 source tripwire: main.js delegates simulation-loop ownership to modes.
 *
 * These assertions keep the retired error-fallback loop family from becoming a
 * second, silently reachable implementation again.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');

describe('main.js legacy loop retirement (plan §5.5)', () => {
    it('starts games exclusively through GameModeManager', () => {
        expect(source).toMatch(/await this\.gameModeManager\.activateMode\(currentMode\);/);
        expect(source).toMatch(/await this\.gameModeManager\.startCurrentMode\(\);/);
        expect(source).toMatch(/console\.error\('\[Main\] Failed to start game:', error\);/);
        expect(source).not.toMatch(/Falling back to legacy multiplayer mode/);
    });

    it('does not contain the retired startup, countdown, loop, or stats methods', () => {
        const retiredNames = [
            'startSinglePlayerGame',
            'startMultiplayerGame',
            'showMultiplayerCountdown',
            'multiplayerGameLoop',
            'updateMultiplayerStats',
        ];

        for (const name of retiredNames) {
            expect(source).not.toContain(name);
        }
        expect(source).not.toMatch(/^\s*gameLoop\s*\(/m);
        expect(source).not.toContain("const sequence = ['3', '2', '1', 'START']");
        expect(source).not.toContain('const tickDuration = 750');
        expect(source).not.toContain('const finalDuration = 900');
    });

    it('does not retain imports owned only by the retired loops', () => {
        for (const retiredImport of [
            'coreGameLoop',
            'coreProcessAutoDrop',
            'fillBag',
            'MultiplayerGameState',
            'seededRandom',
        ]) {
            expect(source).not.toContain(retiredImport);
        }
        expect(source).toMatch(/import \{ hexToRgb \} from '\.\/utils\/helpers\.js';/);
    });

    it('retains the callback and synchronization surface used by Local Multiplayer', () => {
        expect(source).toMatch(/getMultiplayerPhysicsCallbacks\(playerNum, options = \{\}\)/);
        expect(source).toMatch(/async endMultiplayerGame\(losingPlayer\)/);
        expect(source).toMatch(/syncMultiplayerBoardScenes\(\)/);
    });
});

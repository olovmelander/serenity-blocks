/**
 * The test behind every IPC handler, the permission policy and the navigation guard: is this page
 * the game's? On Windows the launcher decides the case of the app's path (`c:\` stays `c:\`) while
 * Chromium always reports a page's URL with an upper-case drive letter, so a case-sensitive
 * comparison refused the game its own IPC. The cases run on Windows' rules on every platform.
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPathInside } from '../../electron/app-path.js';

const WIN_DIST = String.raw`c:\Games\Serenity Blocks\resources\app.asar\dist`;
const inside = (root, target) => isPathInside(root, target, path.win32);

describe('isPathInside on Windows', () => {
    it('accepts the game when launched from a lower-case drive', () => {
        const page = String.raw`C:\Games\Serenity Blocks\resources\app.asar\dist\index.html`;

        expect(inside(WIN_DIST, page)).toBe(true);
    });

    it('accepts the game when launched from an upper-case drive', () => {
        const root = String.raw`C:\Games\Serenity Blocks\resources\app.asar\dist`;
        const page = String.raw`C:\Games\Serenity Blocks\resources\app.asar\dist\index.html`;

        expect(inside(root, page)).toBe(true);
    });

    it('accepts folders inside the root, and a name that only starts with dots', () => {
        expect(inside(WIN_DIST, String.raw`C:\Games\Serenity Blocks\resources\app.asar\dist\assets\a.js`)).toBe(true);
        expect(inside(WIN_DIST, String.raw`C:\Games\Serenity Blocks\resources\app.asar\dist\..notes`)).toBe(true);
    });

    it('refuses the root itself', () => {
        expect(inside(WIN_DIST, WIN_DIST)).toBe(false);
    });

    it('refuses a sibling folder that shares the root\'s prefix', () => {
        expect(inside(WIN_DIST, String.raw`C:\Games\Serenity Blocks\resources\app.asar\dist-evil\index.html`)).toBe(false);
    });

    it('refuses a climb out of the root', () => {
        expect(inside(WIN_DIST, String.raw`C:\Games\Serenity Blocks\resources\app.asar\dist\..\evil.html`)).toBe(false);
        expect(inside(WIN_DIST, String.raw`C:\Games\Serenity Blocks\resources\evil.html`)).toBe(false);
    });

    it('refuses another drive and a network share', () => {
        expect(inside(WIN_DIST, String.raw`D:\Games\Serenity Blocks\resources\app.asar\dist\index.html`)).toBe(false);
        expect(inside(WIN_DIST, String.raw`\\evil\share\dist\index.html`)).toBe(false);
    });
});

describe('isPathInside on POSIX', () => {
    const insidePosix = (root, target) => isPathInside(root, target, path.posix);

    it('keeps paths case-sensitive where the file system is', () => {
        expect(insidePosix('/opt/game/dist', '/opt/game/dist/index.html')).toBe(true);
        expect(insidePosix('/opt/game/dist', '/opt/GAME/dist/index.html')).toBe(false);
    });

    it('refuses a sibling folder and a climb out of the root', () => {
        expect(insidePosix('/opt/game/dist', '/opt/game/dist-evil/index.html')).toBe(false);
        expect(insidePosix('/opt/game/dist', '/opt/game/dist/../evil.html')).toBe(false);
    });
});

describe('the wiring in electron/main.js', () => {
    const mainSource = readFileSync('electron/main.js', 'utf8');

    it('decides a packaged page through isPathInside', () => {
        expect(mainSource).toContain("from './app-path.js'");
        expect(mainSource).toMatch(/return isPathInside\(resolve\(app\.getAppPath\(\), 'dist'\), fileURLToPath\(parsed\)\);/);
    });

    it('keeps no case-sensitive prefix test on the page path', () => {
        expect(mainSource).not.toMatch(/targetPath\.startsWith/);
    });
});

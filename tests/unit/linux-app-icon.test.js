/**
 * The app mark on Linux (scripts/app-icon/linux-icons.mjs): a set of PNGs that are the Windows
 * icon's own images, read by electron-builder's Linux targets and by the window at run time.
 * A Linux executable carries no icon, so without these the game shows Electron's.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ICON_SIZES } from '../../scripts/app-icon/app-mark.mjs';
import { packIco, readPngSize } from '../../scripts/app-icon/ico.mjs';
import {
    LINUX_ICON_DIR,
    LINUX_ICON_SIZES,
    LINUX_WINDOW_ICON_SIZE,
    linuxIconName,
    linuxIconsFromIco,
} from '../../scripts/app-icon/linux-icons.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(path.join(repoRoot, file));

describe('Linux app icon', () => {
    it('ships the Windows icon\'s own images (run node scripts/generate-linux-icons.mjs after the .ico changes)', () => {
        const fromIco = linuxIconsFromIco(read('public/assets/branding/serenity-blocks.ico'));
        expect(fromIco.map((icon) => icon.size)).toEqual([...LINUX_ICON_SIZES]);
        for (const icon of fromIco) {
            const shipped = read(`${LINUX_ICON_DIR}/${icon.name}`);
            expect(shipped.equals(icon.png), icon.name).toBe(true);
            expect(readPngSize(shipped)).toEqual({ width: icon.size, height: icon.size });
        }
    });

    it('holds exactly the set, each file named by its size as electron-builder reads it', () => {
        expect(readdirSync(path.join(repoRoot, LINUX_ICON_DIR)).sort())
            .toEqual(LINUX_ICON_SIZES.map(linuxIconName).sort());
        expect(linuxIconName(48)).toBe('48x48.png');
        // Every size is one the generator draws, so no Linux size is a rescale of another.
        for (const size of LINUX_ICON_SIZES) expect(APP_ICON_SIZES).toContain(size);
        expect(LINUX_ICON_SIZES).toContain(LINUX_WINDOW_ICON_SIZE);
    });

    it('fails loudly when the .ico loses a size the set needs', () => {
        const [first] = linuxIconsFromIco(read('public/assets/branding/serenity-blocks.ico'));
        // An .ico with only the 16 px image: the set's next size is missing.
        expect(() => linuxIconsFromIco(packIco([first.png]))).toThrow(/no 24 px image/);
    });

    it('is what the Linux package and the Linux window are pointed at', () => {
        const manifest = JSON.parse(read('package.json').toString('utf8'));
        expect(manifest.build.linux.icon).toBe(LINUX_ICON_DIR);

        // public/ is copied into dist/, which is packed into app.asar; a dev run has no dist/.
        const main = read('electron/main.js').toString('utf8');
        const windowIcon = `'assets', 'branding', 'linux', '${linuxIconName(LINUX_WINDOW_ICON_SIZE)}'`;
        expect(main).toContain(`join(__dirname, '..', isPackaged ? 'dist' : 'public', ${windowIcon})`);
        expect(main).toContain("...(process.platform === 'linux' ? { icon: LINUX_WINDOW_ICON } : {}),");
        expect(LINUX_ICON_DIR.startsWith('public/')).toBe(true);
    });
});

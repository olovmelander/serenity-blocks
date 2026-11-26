/**
 * The app mark for Linux: the same images as the Windows icon, as loose PNGs.
 *
 * Linux has no icon inside an executable. electron-builder's Linux targets take a directory of
 * `<size>x<size>.png` files (package.json `build.linux.icon`) and the window takes one PNG at run
 * time (electron/main.js). Both read public/assets/branding/linux/, which
 * scripts/generate-linux-icons.mjs fills from the committed .ico, so the two platforms can never
 * show different marks. See docs/desktop-icons.md.
 */
import { readIco } from './ico.mjs';

/** Where the PNGs live, relative to the repository root (and, under dist/, to the web build). */
export const LINUX_ICON_DIR = 'public/assets/branding/linux';

/**
 * The sizes a Linux desktop's icon theme asks for. The .ico also holds 20 and 40 px, which are
 * Windows scaling steps with no place in a Linux icon theme.
 */
export const LINUX_ICON_SIZES = Object.freeze([16, 24, 32, 48, 64, 128, 256]);

/** The size the window icon is given: the largest, which a desktop scales down as it needs. */
export const LINUX_WINDOW_ICON_SIZE = 256;

/** electron-builder reads an icon's size from its file name. @param {number} size */
export const linuxIconName = (size) => `${size}x${size}.png`;

/**
 * The Linux PNGs inside a Windows .ico.
 * @param {Buffer} ico
 * @returns {Array<{ size: number, name: string, png: Buffer }>}
 */
export function linuxIconsFromIco(ico) {
    const entries = readIco(ico);
    return LINUX_ICON_SIZES.map((size) => {
        const entry = entries.find((candidate) => candidate.width === size && candidate.height === size);
        if (!entry) throw new Error(`The .ico holds no ${size} px image for the Linux icon set.`);
        return { size, name: linuxIconName(size), png: entry.png };
    });
}

/**
 * Packs PNG images into one .ico (each entry stored as PNG, which Windows reads at every size
 * since Vista). Shared by scripts/generate-app-icon.mjs and scripts/build-win.mjs.
 */

/** A PNG's width and height from its IHDR chunk. */
export function readPngSize(png) {
    if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
        throw new Error('Not a PNG file.');
    }
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * @param {Buffer[]} pngs one image per size, smallest first
 * @returns {Buffer}
 */
export function packIco(pngs) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(pngs.length, 4);
    const directory = Buffer.alloc(16 * pngs.length);
    let offset = header.length + directory.length;
    pngs.forEach((png, index) => {
        const { width, height } = readPngSize(png);
        const at = index * 16;
        directory.writeUInt8(width >= 256 ? 0 : width, at);
        directory.writeUInt8(height >= 256 ? 0 : height, at + 1);
        directory.writeUInt8(0, at + 2);
        directory.writeUInt8(0, at + 3);
        directory.writeUInt16LE(1, at + 4);
        directory.writeUInt16LE(32, at + 6);
        directory.writeUInt32LE(png.length, at + 8);
        directory.writeUInt32LE(offset, at + 12);
        offset += png.length;
    });
    return Buffer.concat([header, directory, ...pngs]);
}

/**
 * The entries of an .ico: each one's size and image bytes.
 * @param {Buffer} ico
 * @returns {Array<{ width: number, height: number, png: Buffer }>}
 */
export function readIco(ico) {
    if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error('Not an .ico file.');
    const count = ico.readUInt16LE(4);
    return Array.from({ length: count }, (_, index) => {
        const at = 6 + index * 16;
        const length = ico.readUInt32LE(at + 8);
        const offset = ico.readUInt32LE(at + 12);
        return {
            width: ico.readUInt8(at) || 256,
            height: ico.readUInt8(at + 1) || 256,
            png: ico.subarray(offset, offset + length),
        };
    });
}

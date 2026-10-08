/**
 * A minimal 8-bit RGBA PNG writer and reader (zlib only), for the Himalayan Peak bake and its
 * tests. Rows are written with the Sub or Up filter, whichever is smaller for the row.
 */
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let c = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
}

/**
 * @param {Uint8Array} rgba  width × height × 4
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
export function encodePng(rgba, width, height) {
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    const sub = Buffer.alloc(stride);
    const up = Buffer.alloc(stride);
    for (let y = 0; y < height; y++) {
        const row = y * stride;
        let costSub = 0;
        let costUp = 0;
        for (let x = 0; x < stride; x++) {
            const v = rgba[row + x];
            const left = x >= 4 ? rgba[row + x - 4] : 0;
            const above = y > 0 ? rgba[row - stride + x] : 0;
            sub[x] = (v - left) & 255;
            up[x] = (v - above) & 255;
            costSub += sub[x] < 128 ? sub[x] : 256 - sub[x];
            costUp += up[x] < 128 ? up[x] : 256 - up[x];
        }
        const o = y * (stride + 1);
        if (costSub <= costUp) {
            raw[o] = 1;
            sub.copy(raw, o + 1);
        } else {
            raw[o] = 2;
            up.copy(raw, o + 1);
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; // bit depth
    header[9] = 6; // RGBA
    return Buffer.concat([
        SIGNATURE,
        chunk('IHDR', header),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/**
 * Read a PNG this module wrote (8-bit RGBA, filters None / Sub / Up).
 * @param {Buffer} file
 * @returns {{ width: number, height: number, rgba: Uint8Array }}
 */
export function decodePng(file) {
    if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
    let offset = 8;
    let width = 0;
    let height = 0;
    const data = [];
    while (offset < file.length) {
        const length = file.readUInt32BE(offset);
        const type = file.toString('ascii', offset + 4, offset + 8);
        const body = file.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            if (body[8] !== 8 || body[9] !== 6) throw new Error('only 8-bit RGBA PNGs are supported');
        } else if (type === 'IDAT') data.push(body);
        offset += length + 12;
    }
    const raw = zlib.inflateSync(Buffer.concat(data));
    const stride = width * 4;
    const rgba = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const src = y * (stride + 1) + 1;
        const row = y * stride;
        for (let x = 0; x < stride; x++) {
            let v = raw[src + x];
            if (filter === 1) v += x >= 4 ? rgba[row + x - 4] : 0;
            else if (filter === 2) v += y > 0 ? rgba[row - stride + x] : 0;
            else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
            rgba[row + x] = v & 255;
        }
    }
    return { width, height, rgba };
}

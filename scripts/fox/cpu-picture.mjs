/**
 * Pictures without a GPU: an orthographic rasteriser, a PNG writer and a PNG reader, enough to
 * look at a mesh, its skin weights or a pose from Node. Used by the foxes' rigging scripts
 * (scripts/winter/rig-fox.mjs, scripts/sakura/rig-fox.mjs) and their preview (preview-fox.mjs),
 * so a fox can be rigged and animated while the machine's GPU is busy elsewhere.
 */

import { writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

function crc32(buf) {
    let crc = -1;
    for (let n = 0; n < buf.length; n++) {
        let c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ -1) >>> 0;
}

/** An 8-bit RGB PNG. */
export function png(width, height, rgb) {
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body));
        return Buffer.concat([len, body, crc]);
    };
    const head = Buffer.alloc(13);
    head.writeUInt32BE(width, 0);
    head.writeUInt32BE(height, 4);
    head[8] = 8;
    head[9] = 2;
    const row = width * 3 + 1;
    const raw = Buffer.alloc(row * height);
    for (let y = 0; y < height; y++) {
        Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * row + 1);
    }
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', head),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/**
 * Read an 8-bit, non-interlaced PNG (grey, RGB or RGBA, with or without alpha).
 * @returns {{ width: number, height: number, channels: number, data: Uint8Array }}
 */
export function readPng(bytes) {
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const depth = bytes[24];
    const kind = bytes[25];
    const channels = {
        0: 1, 2: 3, 4: 2, 6: 4,
    }[kind];
    if (depth !== 8 || !channels || bytes[28] !== 0) throw new Error('only 8-bit, non-interlaced, unpaletted PNGs are read');
    const parts = [];
    for (let at = 8; at < bytes.length;) {
        const length = bytes.readUInt32BE(at);
        if (bytes.toString('ascii', at + 4, at + 8) === 'IDAT') parts.push(bytes.subarray(at + 8, at + 8 + length));
        at += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(parts));
    const row = width * channels;
    const data = new Uint8Array(row * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (row + 1)];
        const from = y * (row + 1) + 1;
        for (let x = 0; x < row; x++) {
            const left = x >= channels ? data[y * row + x - channels] : 0;
            const up = y > 0 ? data[(y - 1) * row + x] : 0;
            const corner = x >= channels && y > 0 ? data[(y - 1) * row + x - channels] : 0;
            let guess = 0;
            if (filter === 1) guess = left;
            else if (filter === 2) guess = up;
            else if (filter === 3) guess = (left + up) >> 1;
            else if (filter === 4) {
                const p = left + up - corner;
                const pa = Math.abs(p - left);
                const pb = Math.abs(p - up);
                const pc = Math.abs(p - corner);
                if (pa <= pb && pa <= pc) guess = left;
                else guess = pb <= pc ? up : corner;
            }
            data[y * row + x] = (raw[from + x] + guess) & 0xff;
        }
    }
    return {
        width, height, channels, data,
    };
}

const LIGHT = (() => {
    const l = [0.35, 0.8, 0.5];
    const n = Math.hypot(...l);
    return l.map((v) => v / n);
})();

/**
 * An orthographic picture of a triangle mesh, lit per face.
 * @param {object} o
 * @param {ArrayLike<number>} o.positions  xyz per vertex
 * @param {ArrayLike<number>} o.indices
 * @param {(vertex: number) => number[]} [o.colour]  a vertex's colour (0..1 each)
 * @param {number[]} o.right   unit vector across the picture
 * @param {number[]} o.up      unit vector up the picture
 * @param {number[]} o.centre  the point in the middle of the picture
 * @param {number} o.span      metres across the picture's width
 * @param {number} o.width
 * @param {number} o.height
 * @param {number[]} [o.background]  0..255 each
 * @param {number} [o.floor]   height of a ground line to rule (pictures with +y up)
 * @returns {{ rgb: Uint8Array, width: number, height: number, dot: Function, line: Function }}
 */
export function picture(o) {
    const {
        positions, indices, right, up, centre, span, width, height,
    } = o;
    const toward = [
        right[1] * up[2] - right[2] * up[1],
        right[2] * up[0] - right[0] * up[2],
        right[0] * up[1] - right[1] * up[0],
    ];
    const scale = width / span;
    const count = positions.length / 3;
    const sx = new Float32Array(count);
    const sy = new Float32Array(count);
    const sz = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3] - centre[0];
        const y = positions[i * 3 + 1] - centre[1];
        const z = positions[i * 3 + 2] - centre[2];
        sx[i] = width / 2 + (x * right[0] + y * right[1] + z * right[2]) * scale;
        sy[i] = height / 2 - (x * up[0] + y * up[1] + z * up[2]) * scale;
        sz[i] = x * toward[0] + y * toward[1] + z * toward[2];
    }
    const bg = o.background || [22, 28, 40];
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) rgb.set(bg, i * 3);
    const depth = new Float32Array(width * height).fill(-1e9);
    const plain = [0.85, 0.87, 0.92];
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t];
        const b = indices[t + 1];
        const c = indices[t + 2];
        const minX = Math.max(0, Math.floor(Math.min(sx[a], sx[b], sx[c])));
        const maxX = Math.min(width - 1, Math.ceil(Math.max(sx[a], sx[b], sx[c])));
        const minY = Math.max(0, Math.floor(Math.min(sy[a], sy[b], sy[c])));
        const maxY = Math.min(height - 1, Math.ceil(Math.max(sy[a], sy[b], sy[c])));
        const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a]);
        if (maxX < minX || maxY < minY || Math.abs(area) < 1e-9) continue;
        const ux = positions[b * 3] - positions[a * 3];
        const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
        const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
        const vx = positions[c * 3] - positions[a * 3];
        const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
        const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const facing = nx * toward[0] + ny * toward[1] + nz * toward[2];
        const lit = 0.35 + 0.65 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2])
            + 0.15 * (1 - Math.abs(facing));
        const ca = o.colour ? o.colour(a) : plain;
        const cb = o.colour ? o.colour(b) : plain;
        const cc = o.colour ? o.colour(c) : plain;
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const px = x + 0.5;
                const py = y + 0.5;
                const w0 = ((sx[b] - px) * (sy[c] - py) - (sx[c] - px) * (sy[b] - py)) / area;
                const w1 = ((sx[c] - px) * (sy[a] - py) - (sx[a] - px) * (sy[c] - py)) / area;
                const w2 = 1 - w0 - w1;
                if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                const z = w0 * sz[a] + w1 * sz[b] + w2 * sz[c];
                const at = y * width + x;
                if (z <= depth[at]) continue;
                depth[at] = z;
                for (let k = 0; k < 3; k++) {
                    const v = (w0 * ca[k] + w1 * cb[k] + w2 * cc[k]) * lit;
                    rgb[at * 3 + k] = Math.max(0, Math.min(255, Math.round(v * 255)));
                }
            }
        }
    }
    const project = (p) => {
        const x = p[0] - centre[0];
        const y = p[1] - centre[1];
        const z = p[2] - centre[2];
        return [
            width / 2 + (x * right[0] + y * right[1] + z * right[2]) * scale,
            height / 2 - (x * up[0] + y * up[1] + z * up[2]) * scale,
        ];
    };
    const plot = (x, y, colour) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        rgb.set(colour, (y * width + x) * 3);
    };
    /** Mark a point (drawn over everything). */
    const dot = (p, colour = [255, 60, 60], r = 2) => {
        const [cx, cy] = project(p);
        for (let y = Math.round(cy - r); y <= cy + r; y++) {
            for (let x = Math.round(cx - r); x <= cx + r; x++) plot(x, y, colour);
        }
    };
    /** Rule a line between two points (drawn over everything). */
    const line = (p, q, colour = [255, 200, 40]) => {
        const [x0, y0] = project(p);
        const [x1, y1] = project(q);
        const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) || 1;
        for (let i = 0; i <= steps; i++) {
            plot(Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps), colour);
        }
    };
    if (o.floor !== undefined) {
        const reach = [right[0] * span, right[1] * span, right[2] * span];
        line(
            [centre[0] - reach[0], o.floor, centre[2] - reach[2]],
            [centre[0] + reach[0], o.floor, centre[2] + reach[2]],
            [90, 110, 140],
        );
    }
    return {
        rgb, width, height, dot, line,
    };
}

/** Tile pictures of one size into one PNG file. */
export function tile(pictures, cols, file) {
    const { width, height } = pictures[0];
    const rows = Math.ceil(pictures.length / cols);
    const out = new Uint8Array(width * cols * height * rows * 3);
    pictures.forEach((p, i) => {
        const ox = (i % cols) * width;
        const oy = Math.floor(i / cols) * height;
        for (let y = 0; y < height; y++) {
            out.set(p.rgb.subarray(y * width * 3, (y + 1) * width * 3), ((oy + y) * width * cols + ox) * 3);
        }
    });
    writeFileSync(file, png(width * cols, height * rows, out));
    return file;
}

/** The six sides an animal is looked at from: [name, right, up]. */
export const SIDES = Object.freeze({
    left: [[0, 0, -1], [0, 1, 0]],
    right: [[0, 0, 1], [0, 1, 0]],
    front: [[1, 0, 0], [0, 1, 0]],
    behind: [[-1, 0, 0], [0, 1, 0]],
    top: [[0, 0, 1], [1, 0, 0]],
    under: [[0, 0, 1], [-1, 0, 0]],
});

/** A view from `yaw` round the animal (0 = from its left side, + toward its front) and `pitch` above. */
export function orbit(yaw, pitch = 0) {
    // From its left (+x) the picture's right is −z; turning toward the front swings it to +x.
    const right = [Math.sin(yaw), 0, -Math.cos(yaw)];
    const from = [Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)];
    const up = [
        from[1] * right[2] - from[2] * right[1],
        from[2] * right[0] - from[0] * right[2],
        from[0] * right[1] - from[1] * right[0],
    ];
    return [right, up];
}

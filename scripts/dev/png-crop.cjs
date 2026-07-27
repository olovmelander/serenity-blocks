// Dev util: crop + upscale + brighten a PNG so dark regions are legible.
// node scripts/dev/png-crop.cjs <in> <out> <x> <y> <w> <h> <scale> <gain>
const fs = require('fs'); const zlib = require('zlib');
function decode(file) {
  const buf = fs.readFileSync(file); let p = 8, w, h; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p); const t = buf.toString('ascii', p + 4, p + 8);
    if (t === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); }
    if (t === 'IDAT') idat.push(buf.slice(p + 8, p + 8 + len));
    p += 12 + len; if (t === 'IEND') break; }
  const raw = zlib.inflateSync(Buffer.concat(idat)); const bpp = 3, stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp); let o = 0;
  for (let y = 0; y < h; y++) { const ft = raw[o++]; const line = raw.slice(o, o + stride); o += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) { const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[i] = v & 255; } }
  return { w, h, data: out };
}
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function encode(w, h, data, file) {
  const stride = w * 3, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const comp = zlib.deflateSync(raw); const chunks = [];
  const chunk = (type, payload) => { const len = Buffer.alloc(4); len.writeUInt32BE(payload.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
    let crc = 0xFFFFFFFF; for (const B of body) crc = CRC[(crc ^ B) & 255] ^ (crc >>> 8);
    const cb = Buffer.alloc(4); cb.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0); chunks.push(len, body, cb); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  chunk('IHDR', ihdr); chunk('IDAT', comp); chunk('IEND', Buffer.alloc(0));
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]));
}
const [, , inF, outF, X, Y, W, H, S, G] = process.argv;
const x0 = +X, y0 = +Y, cw = +W, ch = +H, s = +(S || 3), gain = +(G || 1);
const img = decode(inF); const ow = cw * s, oh = ch * s, out = Buffer.alloc(ow * oh * 3);
for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
  const sx = Math.min(img.w - 1, x0 + Math.floor(x / s)), sy = Math.min(img.h - 1, y0 + Math.floor(y / s));
  const si = (sy * img.w + sx) * 3, di = (y * ow + x) * 3;
  for (let c = 0; c < 3; c++) out[di + c] = Math.min(255, Math.round(img.data[si + c] * gain));
}
encode(ow, oh, out, outF);
console.log('wrote', outF, ow + 'x' + oh, 'from', img.w + 'x' + img.h);

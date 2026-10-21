// CPU preview of Wolfhour's wolves: poses the real pack (or a single rig) and rasterises the same
// smooth capsule union the shader draws, with a moon rim, onto a contact sheet PNG.
// Usage: node wolf-preview.mjs <spec.json> <out.png>   (WOLF_SRC = the repository root to load)
// A spec: { cols, w, h, panels: [{ t, view: {x0, x1, y0}, onion: [0, -0.2], events: {howl: 10},
// subject: 'pack'|'scout'|'answer', flat }, { rig: { ...poseWolf params }, ground: 'up'|'rough' }] }.
// Panel labels and each wolf's action go to <out>.txt.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const SRC = process.env.WOLF_SRC || process.cwd();
const mod = (p) => import(pathToFileURL(path.join(SRC, p)).href);
const rigMod = await mod('src/themes/wolfhour/wolfhour-wolf-rig.js');
const { CAPSULE_COUNT, CAPSULE_STRIDE, poseWolf } = rigMod;

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3];
const cols = spec.cols ?? 4;
const W = spec.w ?? 480;
const H = spec.h ?? 270;
const rows = Math.ceil(spec.panels.length / cols);
const img = new Float32Array(cols * W * rows * H * 3);
const SW = cols * W;

// ── PNG ──
const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};
function writePng(file, w, h, rgb) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0;
        for (let x = 0; x < w * 3; x++) {
            const v = rgb[y * w * 3 + x];
            raw[y * (w * 3 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(Math.max(0, v) ** (1 / 2.2) * 255)));
        }
    }
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
        return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    fs.writeFileSync(file, Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
    ]));
}

// ── the union, as in the shader ──
function sdf(caps, px, py) {
    let d = 1e3; let gx = 0; let gy = 1;
    for (let i = 0; i < CAPSULE_COUNT; i++) {
        const o = i * CAPSULE_STRIDE;
        const ax = caps[o]; const ay = caps[o + 1]; const bx = caps[o + 2]; const by = caps[o + 3];
        const ra = caps[o + 4]; const rb = caps[o + 5]; const kk = caps[o + 6];
        const pax = px - ax; const pay = py - ay; const bax = bx - ax; const bay = by - ay;
        const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / Math.max(bax * bax + bay * bay, 1e-4)));
        const qx = pax - bax * h; const qy = pay - bay * h;
        const len = Math.max(Math.hypot(qx, qy), 1e-4);
        const dist = len - (ra + (rb - ra) * h);
        const k = Math.max(kk, 1e-3);
        const m = Math.min(1, Math.max(0, 0.5 + ((dist - d) * 0.5) / k));
        d = dist + (d - dist) * m - k * m * (1 - m);
        gx = qx / len + (gx - qx / len) * m;
        gy = qy / len + (gy - qy / len) * m;
    }
    return [d, gx, gy];
}

const MOON = [-0.62, 0.78];
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Draw one silhouette into a panel. `place(px,py)` maps panel pixel → rig coords. */
function drawWolf(panel, caps, toRig, unitsPerPx, moonX, alpha, eyes, tint) {
    const { ox, oy } = panel;
    // Bounding box of the capsules in rig space → panel pixels, via the inverse map's samples.
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const [rx, ry] = toRig(x + 0.5, y + 0.5);
            if (rx < -40 || rx > 44 || ry < -18 || ry > 66) continue;
            const [d, gx, gy] = sdf(caps, rx, ry);
            if (d > unitsPerPx * 2) continue;
            const fw = unitsPerPx;
            const cover = (1 - smoothstep(-fw, fw, d)) * alpha;
            if (cover <= 0) continue;
            const gl = Math.hypot(gx, gy) || 1;
            const facing = (gx / gl) * moonX + (gy / gl) * MOON[1];
            const band = 1 - smoothstep(0, Math.max(fw * 1.7, 0.6), -d);
            const rim = band * smoothstep(0.38, 0.92, facing);
            const sheen = smoothstep(-5, 0, d) * Math.max(0, facing) * 0.25;
            let c = [0.0045 * (1 + sheen) + 0.22 * rim, 0.006 * (1 + sheen) + 0.27 * rim, 0.0105 * (1 + sheen) + 0.38 * rim];
            for (const e of eyes) {
                const g = Math.exp(-((rx - e[0]) ** 2 + (ry - e[1]) ** 2) * 2.6) * e[2];
                c = c.map((v, k) => v + [0.42, 0.48, 0.58][k] * g);
            }
            if (tint) c = c.map((v, k) => v + tint[k]);
            const idx = ((oy + y) * SW + ox + x) * 3;
            for (let k = 0; k < 3; k++) img[idx + k] = img[idx + k] * (1 - cover) + c[k] * cover;
        }
    }
}

function background(panel, view, ground) {
    const { ox, oy } = panel;
    const { x0, x1, y0 } = view;
    const upp = (x1 - x0) / W;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const wx = x0 + (x + 0.5) * upp;
            const wy = y0 + (H - y - 0.5) * upp;
            const sky = y / H;
            let c = [0.035 + 0.05 * sky, 0.05 + 0.065 * sky, 0.11 + 0.09 * sky];
            const g = ground ? ground(wx) : 0;
            if (wy < g) {
                const depth = Math.min(1, (g - wy) / 30);
                c = [0.012 + 0.01 * (1 - depth), 0.016 + 0.012 * (1 - depth), 0.03 + 0.02 * (1 - depth)];
            }
            // a faint unit grid every 10 units, to read distances
            if (spec.grid && (Math.abs(wx % 10) < upp * 0.5 || Math.abs(wy % 10) < upp * 0.5)) c = c.map((v) => v * 1.25);
            const idx = ((oy + y) * SW + ox + x) * 3;
            img[idx] = c[0]; img[idx + 1] = c[1]; img[idx + 2] = c[2];
        }
    }
}

// ── the pack ──
let packMod = null;
let landscapeOnce = null;
async function makePack(kind) {
    packMod ??= await mod('src/themes/wolfhour/wolfhour-wolves.js');
    const pack = packMod.createWolfhourPack({ quality: 'High' });
    const grounds = {};
    const settle = pack.settle.bind(pack);
    pack.settle = (g, opts) => { grounds.pack = g; settle(g, opts); };
    const a = pack.answerer.settle; pack.answerer.settle = (g) => { grounds.answer = g; a(g); };
    const s = pack.scout.settle; pack.scout.settle = (g) => { grounds.scout = g; s(g); };
    if (kind !== 'flat') {
        if (!landscapeOnce) {
            const { createWolfhourLandscape } = await mod('src/themes/wolfhour/wolfhour-landscape.js');
            landscapeOnce = createWolfhourLandscape({ quality: 'High', seed: 73013 });
        }
        const { standWolfhourProps } = await mod('src/themes/wolfhour/wolfhour-props.js');
        standWolfhourProps(landscapeOnce, { pack });
    } else {
        pack.settle(() => 0);
        pack.answerer.settle(() => 0);
        pack.scout.settle(() => 0);
    }
    return { pack, grounds };
}

const packs = new Map();
async function packFor(p) {
    const key = JSON.stringify({ events: p.events ?? {}, flat: !!p.flat });
    if (!packs.has(key)) {
        const made = await makePack(p.flat ? 'flat' : 'real');
        for (const [type, at] of Object.entries(p.events ?? {})) {
            for (const when of [].concat(at)) made.pack[type](when);
        }
        packs.set(key, made);
    }
    return packs.get(key);
}

const DEFAULT_VIEWS = {
    pack: { x0: -90, x1: 100, y0: -30 },
    scout: { x0: -110, x1: 110, y0: -40 },
    answer: { x0: -45, x1: 45, y0: -15 },
    rig: { x0: -40, x1: 44, y0: -12 },
};

const frameLog = [];
for (let i = 0; i < spec.panels.length; i++) {
    const p = spec.panels[i];
    const panel = { ox: (i % cols) * W, oy: Math.floor(i / cols) * H };
    const subject = p.rig ? 'rig' : (p.subject ?? 'pack');
    const view = { ...DEFAULT_VIEWS[subject], ...(spec.view?.[subject] ?? {}), ...(p.view ?? {}) };
    const upp = (view.x1 - view.x0) / W;
    const toWorld = (x, y) => [view.x0 + x * upp, view.y0 + (H - y) * upp];
    if (p.rig) {
        const ground = p.ground === 'up' ? (x) => x * 0.35 : p.ground === 'rough' ? (x) => Math.sin(x * 0.45 + 1) * 1.6 + x * 0.12 : () => 0;
        background(panel, view, ground);
        const times = p.onion ?? [0];
        times.forEach((dt, k) => {
            const params = { ...p.rig };
            for (const [key, val] of Object.entries(p.onionVary ?? {})) params[key] = val[k];
            const rig = poseWolf({ ...params, ground });
            const alpha = k === 0 ? 1 : 0.35;
            drawWolf(
                panel,
                rig.capsules,
                (x, y) => toWorld(x, y),
                upp,
                MOON[0],
                alpha,
                [[rig.eye[0], rig.eye[1], 0.3 * (rig.eye[2] ?? 1)], [rig.eye2[0], rig.eye2[1], 0.3 * (rig.eye2[2] ?? 0)]],
                k === 0 ? null : [0.03, 0.0, 0.0],
            );
        });
        frameLog.push(`${i}: ${p.label ?? ''}`);
        continue;
    }
    const { pack, grounds } = await packFor(p);
    const wolvesFor = () => {
        if (subject === 'scout') return [pack.scout.wolf];
        if (subject === 'answer') return [pack.answerer.wolf];
        return pack.wolves;
    };
    background(panel, view, grounds[subject] ?? (() => 0));
    const onion = p.onion ?? [0];
    // Draw ghosts first (oldest first), then the frame itself on top.
    const order = [...onion].sort((a, b) => a - b);
    for (const dt of order) {
        pack.update(p.t + dt, p.motion ?? 1);
        const ghost = dt !== 0;
        for (const wolf of wolvesFor()) {
            if (!wolf.mesh.visible) continue;
            const caps = new Float32Array(CAPSULE_COUNT * CAPSULE_STRIDE);
            wolf.rows.forEach((r, k) => {
                const c = Math.floor(k / 2) * CAPSULE_STRIDE + (k % 2) * 4;
                caps[c] = r.x; caps[c + 1] = r.y; caps[c + 2] = r.z; caps[c + 3] = r.w;
            });
            const pos = wolf.mesh.position;
            const sx = wolf.mesh.scale.x;
            const sy = wolf.mesh.scale.y;
            const toRig = (x, y) => {
                const [wx, wy] = toWorld(x, y);
                return [(wx - pos.x) / sx, (wy - pos.y) / sy];
            };
            const u = wolf.uniforms;
            drawWolf(
                panel,
                caps,
                toRig,
                upp / Math.abs(sy),
                u.uMoon.value.x,
                ghost ? 0.3 : u.uFade.value,
                ghost ? [] : [[u.uEye.value.x, u.uEye.value.y, u.uEye.value.z], [u.uEye2.value.x, u.uEye2.value.y, u.uEye2.value.z]],
                ghost ? [0.05, 0.01, 0.0] : null,
            );
        }
    }
    const acts = wolvesFor().map((w) => `${w.spec.name}:${w.act?.action ?? '-'}`).join(' ');
    frameLog.push(`${i}: t=${p.t} ${p.label ?? ''} [${acts}]`);
}

writePng(out, SW, rows * H, img);
fs.writeFileSync(out.replace(/\.png$/, '.txt'), frameLog.join('\n'));
console.log(frameLog.join('\n'));
process.exit(0);

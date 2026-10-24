/**
 * Synthwave Sunset — the deco hotels round the bay: Miami Beach Art Deco and Streamline Moderne
 * at dusk, in pastel stucco with white trim and neon. Three kinds, each built from convex prisms
 * in a frame square to the promenade (x along it, away from the pier; y up; z inland, so the sea
 * front is the −z face and the end toward the pier and the camera is the −x face):
 *
 *   streamline  a slab whose corner toward the sea and the pier is a quarter round; ribbon windows
 *               under eyebrow ledges wrap the curve; a drum and a mast stand on the corner and a
 *               vertical neon blade sign projects from the sea front beside it
 *   resort      a tall slab with round ends and a balcony on every floor, a setback crown and a
 *               neon sign on struts at its roof corner, turned to the beach
 *   deco        a symmetric front of pilasters that rise past the parapet in steps, a ziggurat
 *               crown with a spire over the middle, a blade sign at the end toward the pier
 *
 * The facades (windows room by room, eyebrows, balconies, lobbies, neon bands) are shaded, not
 * modelled, and filtered by their pixel footprint, so a far hotel keeps its average instead of
 * shimmering. The signs spell their words in 3 × 5 neon letters. The sun low over the sea warms the
 * fronts that face it; as the evening deepens the windows and the neon take over. One draw; the
 * spires' and masts' beacons join the promenade's lamp bulbs.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    min,
    mix,
    mod,
    normalWorld,
    normalize,
    positionWorld,
    pow,
    select,
    smoothstep,
    step,
    vec2,
    vec3,
    pow3,
} from 'three/tsl';
import {
    SEA_HAZE,
    SHORE,
    linearColor,
    rgb,
    swFilteredPulse,
    swHash21,
    swSkyGradient,
} from './synthwave-sunset-tsl.js';
import { inlandOf } from './synthwave-sunset-sea.js';
import {
    box, prism, roundedRectOutline, strut,
} from './synthwave-sunset-geo.js';
import { BULB } from './synthwave-sunset-bulbs.js';

/** Part kinds in the hotels' attribute (packed with the body and neon colours, see `pack`). */
export const HOTEL_KIND = Object.freeze({
    body: 2, trim: 4, sign: 5,
});

export const HOTEL_STYLE = Object.freeze({ streamline: 0, resort: 1, deco: 2 });

/** Pastel stucco: flamingo, mint, lemon, lilac, peach, white, aqua. */
export const HOTEL_BODY = [0xf6c3d2, 0xbfe9dc, 0xf7e6a6, 0xd9c8f4, 0xf6d2b8, 0xf1ede6, 0xaedfe8];
/** Neon: pink, mint, lemon, sky, lilac, coral. */
export const HOTEL_NEON = [0xff4fa0, 0x4ff0c8, 0xffe46a, 0x5fc4ff, 0xb98cff, 0xff6a4a];
/** The words on the signs, in the order the hotels are built. */
export const HOTEL_WORDS = ['HOTEL', 'LIDO', 'TIDES', 'SURF', 'CORAL', 'ROXY', 'ISLE', 'HOTEL', 'ASTOR'];

/** 3 × 5 letters, rows top to bottom (bit 4 = left column). */
const GLYPH_ROWS = {
    A: ['010', '101', '111', '101', '101'],
    C: ['011', '100', '100', '100', '011'],
    D: ['110', '101', '101', '101', '110'],
    E: ['111', '100', '110', '100', '111'],
    F: ['111', '100', '110', '100', '100'],
    H: ['101', '101', '111', '101', '101'],
    I: ['111', '010', '010', '010', '111'],
    L: ['100', '100', '100', '100', '111'],
    O: ['111', '101', '101', '101', '111'],
    R: ['110', '101', '110', '101', '101'],
    S: ['011', '100', '010', '001', '110'],
    T: ['111', '010', '010', '010', '010'],
    U: ['101', '101', '101', '101', '111'],
    X: ['101', '101', '010', '101', '101'],
    Y: ['101', '101', '010', '010', '010'],
};

/** A letter as one exact integer: five base-8 digits, the bottom row lowest. */
export function glyphCode(letter) {
    const rows = GLYPH_ROWS[letter];
    if (!rows) throw new Error(`no glyph for ${letter}`);
    return rows.reduce((code, row, i) => code + Number.parseInt(row, 2) * (8 ** (4 - i)), 0);
}

const STOREY = [3.1, 3.0, 3.3];
const LOBBY = 4.6;
const PARAPET = 1.2;

/** kind + 8·body + 64·neon, read back with floor(x + 0.5) (an exact small integer). */
const pack = (kind, body, neon) => kind + 8 * body + 64 * neon;

/** One letter cell of a sign: a box whose two broad faces read the letter from either side. */
function letterCell(out, centre, normalAxis, up, w, h, thick, letter, neon) {
    const right = new THREE.Vector3().crossVectors(normalAxis, up); // box z (x × y)
    const basis = { x: normalAxis, y: up, z: right };
    const code = letter ? glyphCode(letter) : -1;
    const d = new THREE.Vector3();
    box(out, centre, new THREE.Vector3(thick / 2, h / 2, w / 2), (f, k, p) => {
        // Face 0 looks along +normalAxis (its reader's right is −z), face 1 along −normalAxis.
        // The edges, and the whole of a cap, are lit tube (u = −1).
        if (f > 1 || !letter) return [pack(HOTEL_KIND.sign, 0, neon), -1, -1, 0];
        d.copy(p).sub(centre);
        const s = f === 0 ? -1 : 1;
        return [pack(HOTEL_KIND.sign, 0, neon), code, 0.5 + (s * d.dot(right)) / w, 0.5 + d.dot(up) / h];
    }, basis);
}

/** A vertical blade sign: the word stacked top to bottom, neon caps above and below. */
function bladeSign(out, top, foot, along, inland, word, neon, cell) {
    const up = new THREE.Vector3(0, 1, 0);
    const n = word.length;
    const { h } = cell;
    for (let i = 0; i < n; i += 1) {
        const c = top.clone().addScaledVector(up, -(i + 0.5) * h);
        letterCell(out, c, along, up, cell.w, h, cell.thick, word[i], neon);
    }
    const capH = 0.45;
    letterCell(out, top.clone().addScaledVector(up, capH / 2), along, up, cell.w + 0.3, capH, cell.thick + 0.1, null, neon);
    letterCell(out, top.clone().addScaledVector(up, -n * h - capH / 2), along, up, cell.w + 0.3, capH, cell.thick + 0.1, null, neon);
    // Two brackets back to the wall.
    for (const y of [top.y - 0.6, top.y - n * h + 0.6]) {
        const a = top.clone().setY(y).addScaledVector(inland, cell.w / 2);
        strut(out, a, a.clone().addScaledVector(inland, 0.5), 0.12, 4, foot);
    }
}

/** A frame square to the promenade at x, `inland` metres back from the waterline. */
function promenadeFrame(x, inland) {
    const q = inlandOf(x, inland);
    const q2 = inlandOf(x + 1, inland);
    const base = new THREE.Vector3(q.x, 0, q.z);
    const along = new THREE.Vector3(q2.x - q.x, 0, q2.z - q.z).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const inl = new THREE.Vector3().crossVectors(along, up);
    return { base, B: { x: along, y: up, z: inl } };
}

/**
 * A plain block of the town: shops between the hotels, or the blocks behind them. Windows by
 * `style`; a roof neon line only when `neonLine`.
 */
function townBlock(out, x, inland, {
    width, depth, floors, style, body, neon, seed, neonLine,
}) {
    const { base, B } = promenadeFrame(x, inland);
    const H = LOBBY + floors * STOREY[style] + PARAPET;
    const top = neonLine ? H : -H;
    prism(out, base, B, roundedRectOutline(width, depth, [0.5, 0.5, 0.5, 0.5], 1), 0, H, (u) => [
        pack(HOTEL_KIND.body, body, neon), u, top, style * 256 + seed,
    ]);
}

/**
 * Builds the hotels into `out` and returns their beacons (bulb rows for the lamp field).
 * @param {object} out    geometry record (aHotel attribute)
 * @param {() => number} rand
 */
export function buildHotels(out, rand) {
    const beacons = [];
    let x = 150;
    let k = 0;
    while (x < 760) {
        const style = [HOTEL_STYLE.streamline, HOTEL_STYLE.resort, HOTEL_STYLE.deco][k % 3];
        const storey = STOREY[style];
        const width = style === HOTEL_STYLE.resort ? 24 + rand() * 8 : 19 + rand() * 10;
        const depth = style === HOTEL_STYLE.resort ? 14 + rand() * 3 : 12 + rand() * 5;
        const floors = style === HOTEL_STYLE.resort ? 8 + Math.floor(rand() * 5) : 3 + Math.floor(rand() * 4);
        const H = LOBBY + floors * storey + PARAPET;
        const inland = SHORE.promenade + 26 + rand() * 18;
        const q = inlandOf(x + width / 2, inland);
        const q2 = inlandOf(x + width / 2 + 1, inland);
        const base = new THREE.Vector3(q.x, 0, q.z);
        const along = new THREE.Vector3(q2.x - q.x, 0, q2.z - q.z).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const inl = new THREE.Vector3().crossVectors(along, up);
        const B = { x: along, y: up, z: inl };
        const body = k % HOTEL_BODY.length;
        const neon = (k * 5 + 1) % HOTEL_NEON.length;
        const seed = Math.floor(rand() * 256);
        const styleSeed = style * 256 + seed;
        const word = HOTEL_WORDS[k % HOTEL_WORDS.length];
        const bodyMeta = (top) => (u) => [pack(HOTEL_KIND.body, body, neon), u, top, styleSeed];
        const trimMeta = (top) => (u) => [pack(HOTEL_KIND.trim, body, neon), u, top, styleSeed];
        const trim = [pack(HOTEL_KIND.trim, body, neon), 0, -1, styleSeed];
        const at = (a, c, y = 0) => base.clone().addScaledVector(along, a).addScaledVector(inl, c).setY(y);
        const hw = width / 2;
        const hd = depth / 2;

        if (style === HOTEL_STYLE.streamline) {
            const r0 = Math.min(width, depth) * 0.45;
            const plan = roundedRectOutline(width, depth, [r0, 0.6, 0.6, 0.6], 8);
            prism(out, base, B, plan, 0, H, bodyMeta(H));
            prism(out, base, B, roundedRectOutline(width + 0.5, depth + 0.5, [r0 + 0.25, 0.85, 0.85, 0.85], 8), H - 0.2, H + 0.2, () => trim);
            // The drum and mast on the round corner.
            const dc = at(-hw + r0, -hd + r0);
            const drumR = r0 * 0.55;
            prism(out, dc, B, roundedRectOutline(drumR * 2, drumR * 2, [drumR, drumR, drumR, drumR], 4), H, H + 4.5, trimMeta(H + 4.5));
            strut(out, dc.clone().setY(H + 4.5), dc.clone().setY(H + 12.5), 0.22, 5, trim);
            strut(out, dc.clone().setY(H + 9).addScaledVector(along, -1.4), dc.clone().setY(H + 9).addScaledVector(along, 1.4), 0.08, 4, trim);
            beacons.push({ p: dc.clone().setY(H + 12.9), neon });
            // The blade sign on the sea front, where the curve meets the straight.
            const cell = { w: 2.6, h: Math.min(3.2, (H + 2.4 - LOBBY - 1.4) / word.length), thick: 0.5 };
            bladeSign(out, at(-hw + r0 + 1.2, -hd - 0.5 - cell.w / 2, H + 2.4), trim, along, inl, word, neon, cell);
        } else if (style === HOTEL_STYLE.resort) {
            const plan = roundedRectOutline(width, depth, [hd, hd, hd, hd], 10);
            prism(out, base, B, plan, 0, H, bodyMeta(H));
            // The crown stands back toward the far end, clear of the corner sign.
            const crownH = 3.2;
            const cw = width * 0.5;
            const cd = depth - 5;
            prism(out, at(width * 0.18, 0), B, roundedRectOutline(cw, cd, [cd / 2, cd / 2, cd / 2, cd / 2], 8), H, H + crownH, trimMeta(H + crownH));
            // A sign on struts on the roof's corner toward the beach, turned to face it.
            const face = along.clone().add(inl).multiplyScalar(-1).normalize(); // toward −x −z
            const cellW = 2.4;
            const cellH = 3.2;
            const n = word.length;
            const centre = at(-hw + hd * 0.9, -hd * 0.25, H + 0.9 + cellH / 2);
            const normalAxis = face.clone().multiplyScalar(-1);
            const right = new THREE.Vector3().crossVectors(normalAxis, up);
            for (let i = 0; i < n; i += 1) {
                const c = centre.clone().addScaledVector(right, (i - (n - 1) / 2) * cellW);
                letterCell(out, c, normalAxis, up, cellW, cellH, 0.4, word[i], neon);
            }
            for (const s of [-1, 1]) {
                const foot = centre.clone().addScaledVector(right, s * (n * cellW * 0.35)).setY(H);
                strut(out, foot, foot.clone().setY(H + 0.95), 0.14, 4, trim);
            }
            beacons.push({ p: at(width * 0.18, 0, H + crownH + 0.6), neon });
        } else {
            const plan = roundedRectOutline(width, depth, [0.8, 0.8, 0.8, 0.8], 2);
            prism(out, base, B, plan, 0, H, bodyMeta(H));
            // Pilasters up the sea front, rising past the parapet in steps toward the middle.
            const bay = 4.2;
            for (let a = -hw + 0.8 + bay; a < hw - 0.8 - 1; a += bay) {
                const rise = 0.8 + 2.6 * Math.max(0, 1 - Math.abs(a) / hw);
                box(out, at(a, -hd - 0.25, (H + rise) / 2), new THREE.Vector3(0.35, (H + rise) / 2, 0.3), trim, B);
            }
            // The ziggurat over the middle of the front, and its spire.
            const tiers = [[0.24, 0.28, 3.6], [0.15, 0.2, 3.0], [0.08, 0.12, 2.6]];
            let y = H;
            tiers.forEach(([fa, fc, th]) => {
                const tw = width * fa * 2;
                const td = depth * fc * 2;
                const centre = at(0, -hd + td / 2 + 0.4);
                prism(out, centre, B, roundedRectOutline(tw, td, [0.3, 0.3, 0.3, 0.3], 1), y, y + th, trimMeta(y + th));
                y += th;
            });
            const sp = at(0, -hd + depth * 0.12 + 0.4);
            strut(out, sp.clone().setY(y), sp.clone().setY(y + 7), 0.2, 5, trim);
            beacons.push({ p: sp.clone().setY(y + 7.3), neon });
            const cell = { w: 2.4, h: Math.min(3.0, (H + 1.6 - LOBBY - 1.4) / word.length), thick: 0.45 };
            bladeSign(out, at(-hw + 1.6, -hd - 0.5 - cell.w / 2, H + 1.6), trim, along, inl, word, neon, cell);
        }
        // The gap to the next hotel holds a low shop or two, set back with the hotels.
        const gap = 5 + rand() * 10;
        if (gap > 5.2) {
            townBlock(out, x + width + gap / 2, SHORE.promenade + 30 + rand() * 6, {
                width: gap - 1.6,
                depth: 9,
                floors: rand() < 0.4 ? 2 : 1,
                style: k % 2 ? HOTEL_STYLE.deco : HOTEL_STYLE.streamline,
                body: (k + 3) % HOTEL_BODY.length,
                neon: (k * 5 + 3) % HOTEL_NEON.length,
                seed: Math.floor(rand() * 256),
                neonLine: true,
            });
        }
        x += width + gap;
        k += 1;
    }
    // A second row behind, taller and plainer, to give the town some depth.
    for (let bx = 168, j = 0; bx < 760; j += 1) {
        const width = 16 + rand() * 10;
        townBlock(out, bx + width / 2, SHORE.promenade + 72 + rand() * 18, {
            width,
            depth: 12 + rand() * 4,
            floors: 4 + Math.floor(rand() * 8),
            style: j % 2 ? HOTEL_STYLE.resort : HOTEL_STYLE.deco,
            body: (j * 3 + 2) % HOTEL_BODY.length,
            neon: (j * 2 + 1) % HOTEL_NEON.length,
            seed: Math.floor(rand() * 256),
            neonLine: j % 3 === 0,
        });
        bx += width + 10 + rand() * 22;
    }
    return beacons.map(({ p, neon }, i) => ({
        p, size: 0.8, color: linearColor(HOTEL_NEON[neon]), program: BULB.globe, index: i, count: beacons.length, along: 1, level: 1.3,
    }));
}

/**
 * A box-filtered band [a, b] of x (not repeating): the fraction of the pixel footprint
 * [x − w/2, x + w/2] inside it, so a neon line a pixel tall keeps a steady brightness.
 */
const band = (x, w, a, b) => {
    const hw = max(w, 1e-4).mul(0.5);
    return clamp(min(x.add(hw), b).sub(max(x.sub(hw), a)).div(hw.mul(2.0)), 0.0, 1.0);
};

const pick = (index, colors) => colors.slice(1).reduce(
    (acc, c, i) => select(index.lessThan(i + 0.5), acc, rgb(c)),
    rgb(colors[0]),
);

/** The hotels' material: stucco, trim, windows, lobbies, neon bands and the signs' letters. */
export function createHotelMaterial(u) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveHotels';
    material.fog = false;
    const meta = attribute('aHotel', 'vec4');
    material.colorNode = Fn(() => {
        const p = positionWorld;
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(rel);
        const V = rel.div(dist);
        const N = normalize(normalWorld).toVar();
        const kp = floor(meta.x.add(0.5)).toVar();
        const kind = mod(kp, 8.0);
        const bodyIdx = mod(floor(kp.div(8.0)), 8.0);
        const neonIdx = floor(kp.div(64.0));
        const uArc = meta.y;
        const top = meta.z;
        const ss = floor(meta.w.add(0.5));
        const style = floor(ss.div(256.0));
        const seed = mod(ss, 256.0);

        // Light: the dusk sky from above, the sun low over the sea on the fronts that face it.
        const duskLight = mix(float(1.0), float(0.5), u.dusk);
        const facing = abs(dot(N, V));
        const sky = rgb(0xa496bc, 0.4).mul(float(0.55).add(max(N.y, 0.0).mul(0.45))).mul(duskLight);
        const sunLit = max(dot(N, normalize(vec3(u.sunDir.x, 0.0, u.sunDir.z))), 0.0);
        const sunKey = rgb(0xff9c86, 0.38).mul(sunLit).mul(float(1.0).sub(smoothstep(0.15, 0.8, u.dusk)));
        const rim = pow3(float(1.0).sub(facing)).mul(rgb(0xff8a5c, 0.25)).mul(mix(float(1.0), float(0.3), u.dusk));
        const light = sky.add(sunKey);
        const lights = u.townLights;

        const bodyAlb = pick(bodyIdx, HOTEL_BODY);
        const trimAlb = select(bodyIdx.equal(5.0), rgb(0x9fd8dc), rgb(0xfbf6ee));
        const neonCol = pick(neonIdx, HOTEL_NEON);
        const side = float(1.0).sub(step(0.5, abs(N.y)));

        // ── Facade: storeys above the lobby, windows by style, eyebrows or balconies ──
        const storey = select(style.lessThan(0.5), float(STOREY[0]), select(style.lessThan(1.5), float(STOREY[1]), float(STOREY[2])));
        const fy = p.y.sub(LOBBY).div(storey);
        const v = fract(fy);
        const floorIdx = floor(fy);
        const isStream = step(style, 0.5);
        const isResort = step(0.5, style).mul(step(style, 1.5));
        const isDeco = step(1.5, style);
        const colW = mix(mix(float(2.1), float(2.4), isResort), float(1.7), isStream);
        const uc = uArc.div(colW);
        const fwU = max(fwidth(uc), 1e-4);
        const fwV = max(fwidth(fy), 1e-4);
        const far = smoothstep(0.3, 0.85, max(fwU, fwV)).toVar();
        // Ribbon windows (streamline, thin mullions), sliding doors (resort), punched pairs (deco).
        const uLo = mix(mix(float(0.22), float(0.1), isResort), float(0.06), isStream);
        const vLo = mix(mix(float(0.24), float(0.1), isResort), float(0.3), isStream);
        const vHi = mix(mix(float(0.8), float(0.74), isResort), float(0.78), isStream);
        const winU = swFilteredPulse(uc, fwU.mul(1.25), uLo, float(1.0).sub(uLo));
        const winV = swFilteredPulse(fy, fwV.mul(1.25), vLo, vHi);
        // (A negative top marks a block without a roof neon line.)
        const upper = step(LOBBY + 0.2, p.y).mul(step(p.y, abs(top).sub(PARAPET + 0.1)));
        const win = winU.mul(winV).mul(upper).mul(side);
        // Rooms: lit or dark, warm, white, rose or the blue of a television.
        const room = vec2(floor(uc.div(2.0)), floorIdx).add(vec2(seed.mul(0.37), seed.mul(0.11)));
        const hLit = swHash21(room);
        const hCol = swHash21(room.add(vec2(17.0, 3.0)));
        const litChance = mix(float(0.26), float(0.52), clamp(lights.sub(0.5).mul(2.0), 0.0, 1.0));
        const lit = mix(step(hLit, litChance), litChance, far);
        const roomCol = select(hCol.lessThan(0.55), rgb(0xffbe6e, 0.95), select(
            hCol.lessThan(0.76),
            rgb(0xffe0b4, 0.85),
            select(hCol.lessThan(0.89), rgb(0xff94b6, 0.9), rgb(0x86d4ff, 0.8)),
        ));
        const glass = rgb(0x2c3060).mul(light.mul(0.9)).add(rim.mul(0.5));
        // Eyebrow ledges over each storey (streamline: continuous, deco: over each window) and the
        // resort's balconies: a lit slab edge, its shadow on the window head, a white railing.
        const ledgeV = swFilteredPulse(fy, fwV.mul(1.25), float(0.84), float(0.94)).mul(upper);
        const eyebrow = ledgeV.mul(mix(float(1.0), swFilteredPulse(uc, fwU.mul(1.25), float(0.12), float(0.88)), isDeco));
        const shadowBand = smoothstep(0.6, 0.84, v).mul(float(1.0).sub(step(0.9, v))).mul(upper).mul(side);
        const rail = swFilteredPulse(fy, fwV.mul(1.25), float(0.0), float(0.3)).mul(isResort).mul(upper);
        // The street lamps and lobbies wash the lower floors warm; the roof neon spills down the
        // parapet in its own colour.
        const streetGlow = rgb(0xffb070, 0.3).mul(float(1.0).sub(smoothstep(2.0, 16.0, p.y))).mul(lights).mul(side);
        const neonSpill = neonCol.mul(0.16).mul(exp(max(top.sub(0.5).sub(p.y), 0.0).mul(-0.4)))
            .mul(step(0.0, top)).mul(side)
            .mul(lights);
        const stucco = bodyAlb.mul(light.add(streetGlow).add(neonSpill))
            .mul(float(1.0).sub(shadowBand.mul(mix(float(0.3), float(0.1), far))));
        const winSurf = mix(glass, glass.mul(0.6), lit);
        let facade = mix(stucco, winSurf, win.mul(float(1.0).sub(far.mul(0.45))));
        facade = mix(facade, trimAlb.mul(light.mul(1.15)).add(rim), max(eyebrow.mul(mix(float(1.0), float(0.55), far)), rail.mul(0.85)));
        const winGlow = roomCol.mul(lit).mul(win).mul(lights).mul(float(1.0).sub(rail.mul(0.6)));

        // The lobby: a storefront of warm glass under a canopy with neon along its edge.
        const lobbyU = swFilteredPulse(uArc.div(2.4), max(fwidth(uArc.div(2.4)), 1e-4).mul(1.25), float(0.06), float(0.94));
        const lobbyGlass = smoothstep(0.45, 0.6, p.y).mul(float(1.0).sub(smoothstep(3.4, 3.55, p.y))).mul(lobbyU).mul(side);
        const canopy = smoothstep(3.7, 3.8, p.y).mul(float(1.0).sub(smoothstep(4.25, 4.35, p.y))).mul(side);
        const fwY = max(fwidth(p.y), 1e-4).mul(1.25);
        const marquee = band(p.y, fwY, float(3.66), float(3.82)).mul(side);
        facade = mix(facade, trimAlb.mul(light), canopy);
        const lobbyGlow = rgb(0xffd49a, 1.15).mul(lobbyGlass).mul(lights);

        // Neon along the roofline (two lines on a streamline hotel) and at the top of each tier.
        const roofNeon = band(p.y, fwY, top.sub(0.62), top.sub(0.4))
            .add(band(p.y, fwY, top.sub(1.12), top.sub(0.94)).mul(isStream)).mul(side).mul(step(0.0, top));
        const neonGlow = neonCol.mul(2.8).mul(roofNeon.add(marquee.mul(0.8))).mul(max(lights, 0.6));

        const bodySurf = facade.add(rim.mul(0.6));
        const bodyEmit = winGlow.add(lobbyGlow).add(neonGlow);
        const trimSurf = trimAlb.mul(light).add(rim);

        // ── Signs: dark enamel, a neon border, the letter in 3 × 5 tubes; edges glow ──
        const code = uArc;
        const su = meta.z;
        const sv = meta.w;
        const gu = su.sub(0.18).div(0.64);
        const gv = sv.sub(0.11).div(0.78);
        const inGlyph = step(0.0, gu).mul(step(gu, 1.0)).mul(step(0.0, gv)).mul(step(gv, 1.0));
        const gx = clamp(floor(gu.mul(3.0)), 0.0, 2.0);
        const gy = clamp(floor(gv.mul(5.0)), 0.0, 4.0);
        const pow8 = select(gy.lessThan(0.5), float(1.0), select(gy.lessThan(1.5), float(8.0), select(
            gy.lessThan(2.5),
            float(64.0),
            select(gy.lessThan(3.5), float(512.0), float(4096.0)),
        )));
        const digit = mod(floor(code.add(0.5).div(pow8)), 8.0);
        const pow2 = select(gx.lessThan(0.5), float(4.0), select(gx.lessThan(1.5), float(2.0), float(1.0)));
        const bit = mod(floor(digit.add(0.5).div(pow2)), 2.0).mul(inGlyph).mul(step(0.0, code));
        const fwS = max(fwidth(gu.mul(3.0)), fwidth(gv.mul(5.0)));
        const letter = mix(bit, float(0.42).mul(step(0.0, code)), smoothstep(0.35, 0.9, fwS));
        const border = swFilteredPulse(su, max(fwidth(su), 1e-4).mul(1.25), float(0.03), float(0.085))
            .add(swFilteredPulse(su, max(fwidth(su), 1e-4).mul(1.25), float(0.915), float(0.97)));
        const isEdge = step(su, -0.5);
        const signSurf = rgb(0x1a1838).mul(light).add(rim.mul(0.4));
        const signEmit = neonCol.mul(max(lights, 0.65)).mul(mix(letter.add(border).mul(3.2), float(1.3), isEdge));

        const isTrim = step(3.5, kind).mul(step(kind, 4.5));
        const isSign = step(4.5, kind);
        const surf = mix(mix(bodySurf, trimSurf, isTrim), signSurf, isSign);
        const trimNeon = neonCol.mul(2.6).mul(band(p.y, fwY, top.sub(0.5), top.sub(0.25))).mul(side)
            .mul(step(0.0, top))
            .mul(max(lights, 0.6));
        const emit = mix(mix(bodyEmit, trimNeon, isTrim), signEmit, isSign);

        // Far hotels sit in the bay's haze; their lights cut through it better than their walls.
        const haze = float(1.0).sub(pow(float(1.0).sub(smoothstep(0.0, 1.0, dist.mul(SEA_HAZE * 1.6))), 1.5));
        const hazeCol = swSkyGradient(u, normalize(vec3(V.x, 0.0, V.z))).color;
        return mix(surf, hazeCol, haze.mul(0.85)).add(emit.mul(float(1.0).sub(haze.mul(0.6))));
    })();
    return material;
}

/** Where the facade's storeys start and how tall they are. */
export const HOTEL_FACADE = Object.freeze({ lobby: LOBBY, parapet: PARAPET, storey: STOREY });

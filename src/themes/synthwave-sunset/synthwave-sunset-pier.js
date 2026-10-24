/**
 * Synthwave Sunset — the pleasure pier: a timber deck on bents of piles running from the
 * promenade out to the wheel's platform, white railings and lamp posts, an entrance arch with a
 * sunburst of bulbs, and onion-dome pavilions with lit arched windows.
 *
 * Two draws: the STRUCTURE (one merged static mesh; `aPier.x` picks the material: timber, white
 * paint, pastel walls, striped domes, neon tubes) and the BULBS (synthwave-sunset-bulbs.js). The
 * eye stands below the deck, so what it sees of the pier is the fascia, the railings, the piles
 * and their cross-bracing against the bright sea, and the buildings' walls and domes; the deck top
 * is never seen.
 *
 * Nothing tall stands on the outer 40 m of the pier: the sun sets behind the wheel's lower half
 * there and must stay visible through the spokes.
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
    fract,
    fwidth,
    max,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    select,
    smoothstep,
    sqrt,
    pow3,
} from 'three/tsl';
import { RIG, linearColor, rgb } from './synthwave-sunset-tsl.js';
import { PIER, PIER_HEAD, pierFrame } from './synthwave-sunset-layout.js';
import {
    box, lathe, makeOut, strut, toGeometry, tube,
} from './synthwave-sunset-geo.js';
import { BULB, createBulbField } from './synthwave-sunset-bulbs.js';

const KIND = {
    timber: 0, paint: 1, wall: 2, dome: 3, neon: 4, sign: 5,
};

/** The buildings: where they stand (metres from the wheel's end), size, colours. */
export const PAVILIONS = Object.freeze([
    {
        s: 146, along: 11, across: 8.2, height: 5.2, dome: 4.1, wall: 0, stripes: 0,
    },
    {
        s: 112, along: 9, across: 7.4, height: 4.6, dome: 3.6, wall: 1, stripes: 1,
    },
    {
        s: 93, along: 7, across: 6.2, height: 4.0, dome: 3.0, wall: 2, stripes: 0,
    },
]);

/**
 * The pylon sign at the land end: a tall neon slab beside the pier's entrance, its face turned to
 * the camera (an arch across the deck would be seen edge-on from the beach), a starburst on top.
 */
const PYLON = Object.freeze({
    s: 158, across: 7.2, height: 21, width: 3.4, depth: 1.1,
});

/** The pylon's frame: centre at half height, a basis whose z faces the rest camera. */
function pylonFrame(frame) {
    const base = frame.at(PYLON.s, PYLON.across, 0);
    const toCam = new THREE.Vector3(RIG.x - base.x, 0, RIG.z - base.z).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3().crossVectors(up, toCam);
    return { base, basis: { x, y: up, z: toCam } };
}

const WALL_COLORS = [0xf2dcc6, 0xbfe6da, 0xf2c6d6];
const NEON_COLORS = [0xff4fa0, 0x4ff0c8, 0xffe45a, 0xb48cff];

function buildPier(frame) {
    const out = makeOut();
    const { deckY, deckThickness, width } = PIER;
    const L = frame.length;
    const half = width / 2;
    const timber = [KIND.timber, 0, 0, 0];
    const paint = [KIND.paint, 0, 0, 0];
    const B = frame.basis;

    // ── Deck slab and its fascia ──
    box(out, frame.at(L / 2, 0, deckY - deckThickness / 2), new THREE.Vector3(L / 2, deckThickness / 2, half), timber, B);

    // ── The pier head: the deck turns square into a T under the wheel, on its own piles ──
    const H = PIER_HEAD;
    const hw = H.halfAcross;
    box(
        out,
        frame.at((H.s0 + H.s1) / 2, 0, deckY - deckThickness / 2),
        new THREE.Vector3((H.s1 - H.s0) / 2, deckThickness / 2, hw),
        timber,
        B,
    );
    const headRows = [H.s0 + 1.2, (H.s0 + H.s1) / 2, H.s1 - 1.2];
    const headPiles = [];
    for (let k = 0; k <= 8; k += 1) headPiles.push(-hw + 0.8 + ((2 * hw - 1.6) * k) / 8);
    headRows.forEach((s, row) => {
        headPiles.forEach((c) => strut(out, frame.at(s, c, -3.0), frame.at(s, c, deckY - deckThickness), 0.38, 7, timber));
        box(out, frame.at(s, 0, deckY - deckThickness - 0.3), new THREE.Vector3(0.45, 0.3, hw + 0.2), timber, B);
        for (let k = 0; k < headPiles.length - 1; k += 1) {
            const [a, b] = (k + row) % 2 ? [headPiles[k], headPiles[k + 1]] : [headPiles[k + 1], headPiles[k]];
            strut(out, frame.at(s, a, 0.4), frame.at(s, b, deckY - deckThickness - 0.5), 0.13, 4, timber);
        }
    });
    // Its railing: the seaward front, both ends, and the landward edges either side of the pier.
    const headEdges = [
        [[H.s0 + 0.15, -hw + 0.15], [H.s0 + 0.15, hw - 0.15]],
        [[H.s0 + 0.15, hw - 0.15], [H.s1 - 0.15, hw - 0.15]],
        [[H.s0 + 0.15, -hw + 0.15], [H.s1 - 0.15, -hw + 0.15]],
        [[H.s1 - 0.15, half], [H.s1 - 0.15, hw - 0.15]],
        [[H.s1 - 0.15, -half], [H.s1 - 0.15, -hw + 0.15]],
    ];
    headEdges.forEach(([[sa, ca], [sb, cb]]) => {
        const n = Math.max(1, Math.round(Math.hypot(sb - sa, cb - ca) / 2.5));
        for (let k = 0; k <= n; k += 1) {
            const f = k / n;
            const s = sa + (sb - sa) * f;
            const c = ca + (cb - ca) * f;
            strut(out, frame.at(s, c, deckY), frame.at(s, c, deckY + 1.15), 0.06, 4, paint);
        }
        tube(out, [frame.at(sa, ca, deckY + 1.15), frame.at(sb, cb, deckY + 1.15)], 0.07, 5, false, paint);
        tube(out, [frame.at(sa, ca, deckY + 0.6), frame.at(sb, cb, deckY + 0.6)], 0.045, 4, false, paint);
    });
    // Lamps at its four corners.
    const headLamps = [];
    for (const s of [H.s0 + 0.7, H.s1 - 0.7]) {
        for (const sign of [-1, 1]) {
            const c = sign * (hw - 0.7);
            strut(out, frame.at(s, c, deckY), frame.at(s, c, deckY + 4.6), 0.11, 6, paint);
            headLamps.push({ s, c, h: deckY + 4.85 });
        }
    }

    // ── Bents: three piles, a cap beam, an X-brace between the outer piles ──
    for (let s = H.s1 + 2; s < L; s += PIER.bentSpacing) {
        const piles = [-half + 0.6, 0, half - 0.6];
        piles.forEach((c) => strut(out, frame.at(s, c, -3.0), frame.at(s, c, deckY - deckThickness), 0.36, 7, timber));
        box(out, frame.at(s, 0, deckY - deckThickness - 0.3), new THREE.Vector3(0.4, 0.3, half + 0.2), timber, B);
        strut(out, frame.at(s, piles[0], 0.4), frame.at(s, piles[2], deckY - deckThickness - 0.5), 0.13, 4, timber);
        strut(out, frame.at(s, piles[2], 0.4), frame.at(s, piles[0], deckY - deckThickness - 0.5), 0.13, 4, timber);
    }

    // ── Railings: posts every 2.5 m, a top rail and a mid rail, both sides ──
    for (const c of [half - 0.15, -half + 0.15]) {
        for (let s = H.s1 + 1; s < L - 0.5; s += 2.5) {
            strut(out, frame.at(s, c, deckY), frame.at(s, c, deckY + 1.15), 0.06, 4, paint);
        }
        tube(out, [frame.at(H.s1 - 0.15, c, deckY + 1.15), frame.at(L - 0.3, c, deckY + 1.15)], 0.07, 5, false, paint);
        tube(out, [frame.at(H.s1 - 0.15, c, deckY + 0.6), frame.at(L - 0.3, c, deckY + 0.6)], 0.045, 4, false, paint);
    }

    // ── Lamp posts every 12 m, alternating sides ──
    const lamps = [];
    let side = 1;
    for (let s = H.s1 + 6; s < L - 4; s += 12) {
        const c = side * (half - 0.4);
        strut(out, frame.at(s, c, deckY), frame.at(s, c, deckY + 4.6), 0.11, 6, paint);
        strut(out, frame.at(s, c, deckY + 4.3), frame.at(s, c - side * 0.7, deckY + 4.6), 0.06, 4, paint);
        lamps.push({ s, c: c - side * 0.7, h: deckY + 4.45 });
        side = -side;
    }

    // ── The pylon sign: a dark slab with neon edges and bands, a ball and spike on top ──
    const py = pylonFrame(frame);
    const P = (x, y, z) => py.base.clone().addScaledVector(py.basis.x, x).addScaledVector(py.basis.y, y)
        .addScaledVector(py.basis.z, z);
    box(out, P(0, PYLON.height / 2, 0), new THREE.Vector3(PYLON.width / 2, PYLON.height / 2, PYLON.depth / 2), [KIND.sign, 0, 0, 0], py.basis);
    box(out, P(0, 0.6, 0), new THREE.Vector3(PYLON.width / 2 + 0.6, 0.6, PYLON.depth / 2 + 0.6), paint, py.basis);
    const wf = PYLON.width / 2 + 0.12;
    const zf = PYLON.depth / 2 + 0.12;
    const outline = [P(-wf, 1.4, zf), P(wf, 1.4, zf), P(wf, PYLON.height - 0.2, zf), P(-wf, PYLON.height - 0.2, zf)];
    tube(out, outline, 0.11, 5, true, [KIND.neon, 0, 0, 0]);
    for (const [h, color] of [[PYLON.height * 0.34, 1], [PYLON.height * 0.68, 2]]) {
        tube(out, [P(-wf, h, zf), P(wf, h, zf)], 0.09, 5, false, [KIND.neon, color, 0, 0]);
    }
    const crown = P(0, PYLON.height + 1.6, 0);
    lathe(out, P(0, PYLON.height, 0), [[0.5, 0], [1.25, 0.9], [1.35, 1.6], [1.0, 2.4], [0.2, 3.1], [0.05, 3.2]], 16, () => [KIND.paint, 0, 0, 0]);
    strut(out, P(0, PYLON.height + 3.1, 0), P(0, PYLON.height + 5.4, 0), 0.07, 4, paint);

    // ── Pavilions: a box with arched windows, a cornice, an onion dome and a finial ──
    const domes = [];
    PAVILIONS.forEach((pv, i) => {
        const c0 = 0;
        const center = frame.at(pv.s, c0, deckY + pv.height / 2);
        const metaWall = (f, k, p) => {
            // Along-wall coordinate for the window pattern: faces ±along use the across axis.
            const rel = p.clone().sub(frame.far);
            const coord = f < 2 ? rel.dot(frame.across) : rel.dot(frame.along);
            return [KIND.wall, coord, p.y - deckY, pv.wall];
        };
        box(out, center, new THREE.Vector3(pv.along / 2, pv.height / 2, pv.across / 2), metaWall, B);
        box(out, frame.at(pv.s, c0, deckY + pv.height + 0.25), new THREE.Vector3(pv.along / 2 + 0.35, 0.25, pv.across / 2 + 0.35), paint, B);
        const r = pv.dome;
        const profile = [
            [r * 0.78, 0], [r * 0.95, r * 0.35], [r, r * 0.6], [r * 0.9, r * 0.95], [r * 0.62, r * 1.3],
            [r * 0.3, r * 1.62], [r * 0.1, r * 1.88], [0.06, r * 2.05],
        ];
        const domeBase = frame.at(pv.s, c0, deckY + pv.height + 0.5);
        lathe(out, domeBase, profile, 24, (af, hf) => [KIND.dome, af, hf, pv.stripes]);
        const tip = domeBase.clone().add(new THREE.Vector3(0, r * 2.05, 0));
        strut(out, tip, tip.clone().add(new THREE.Vector3(0, 1.6, 0)), 0.08, 4, paint);
        domes.push({
            base: domeBase, profile, tip: tip.clone().add(new THREE.Vector3(0, 1.7, 0)), pv, index: i,
        });
    });

    return {
        out, lamps, domes, pylon: { P, crown }, head: { edges: headEdges, lamps: headLamps },
    };
}

function createPierMaterial(u) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwavePier';
    material.fog = false;
    const meta = attribute('aPier', 'vec4');

    material.colorNode = Fn(() => {
        const kind = meta.x;
        const p = positionWorld;
        const V = normalize(p.sub(cameraPosition)).toVar();
        const N = normalize(normalWorld).toVar();
        const facing = abs(dot(N, V));
        const duskLight = mix(float(1.0), float(0.55), u.dusk);
        // Dusk light: a lilac sky from above, the sunset behind as a warm rim.
        const sky = rgb(0x8a7aa8, 0.3).mul(float(0.55).add(max(N.y, 0.0).mul(0.45))).mul(duskLight);
        const rim = pow3(float(1.0).sub(facing)).mul(max(dot(N, u.sunDir), 0.0).mul(0.8).add(0.2))
            .mul(rgb(0xff8a5c, 0.5)).mul(mix(float(1.0), float(0.35), u.dusk));
        // The railing bulbs wash the fascia and the walls just above the deck in warm light.
        const h = p.y.sub(PIER.deckY);
        const wash = exp(abs(h.sub(0.6)).mul(-0.9)).mul(rgb(0xffb070, 0.32)).mul(u.pierGlow).mul(u.pierPower);

        const timberCol = rgb(0x3a2a32).mul(sky.add(wash.mul(0.7))).add(rim.mul(0.6));
        const paintCol = rgb(0xe8dce0).mul(sky.add(wash)).add(rim);

        // Walls: pastel with rows of lit arched windows.
        const wallIdx = meta.w;
        const wallAlb = select(wallIdx.lessThan(0.5), rgb(WALL_COLORS[0]), select(wallIdx.lessThan(1.5), rgb(WALL_COLORS[1]), rgb(WALL_COLORS[2])));
        const wu = meta.y.div(2.1);
        const cell = fract(wu).sub(0.5);
        const wv = meta.z;
        const fwU = max(fwidth(wu), 1e-3);
        const inX = float(1.0).sub(smoothstep(0.24, float(0.24).add(fwU.mul(1.5)), abs(cell)));
        // An arched head: the window's top is a half circle of radius 0.24 cells.
        const archTop = float(2.9).add(sqrt(clamp(float(0.0576).sub(cell.mul(cell)), 0.0, 1.0)).mul(2.1));
        const fwV = max(fwidth(wv), 1e-3);
        const inY = smoothstep(0.9, float(0.9).add(fwV.mul(1.5)), wv).mul(float(1.0).sub(smoothstep(archTop.sub(fwV.mul(1.5)), archTop, wv)));
        const isWin = inX.mul(inY);
        const winCol = rgb(0xffcf8a, 1.7).mul(u.pierGlow).mul(u.pierPower.mul(0.7).add(0.3));
        const wallCol = mix(wallAlb.mul(sky.add(wash)).add(rim), winCol, isWin);

        // Domes: stripes round the bulb, a warm uplight from the cornice bulbs.
        const stripe = fract(meta.y.mul(16.0));
        const fwS = max(fwidth(meta.y.mul(16.0)), 1e-3);
        const band = smoothstep(0.5, float(0.5).add(fwS), stripe).mul(float(1.0).sub(smoothstep(float(1.0).sub(fwS), 1.0, stripe)));
        const pair = meta.w;
        const stripeA = select(pair.lessThan(0.5), rgb(0xe0608c), rgb(0x5fd2b8));
        const stripeB = rgb(0xf2d2bc);
        const uplight = exp(meta.z.mul(-3.0)).mul(rgb(0xffb070, 0.3)).mul(u.pierGlow).mul(u.pierPower);
        const domeCol = mix(stripeA, stripeB, band).mul(sky.mul(1.1).add(uplight)).add(rim);

        const ni = meta.y;
        const neonHue = select(ni.lessThan(0.5), rgb(NEON_COLORS[0]), select(
            ni.lessThan(1.5),
            rgb(NEON_COLORS[1]),
            select(ni.lessThan(2.5), rgb(NEON_COLORS[2]), rgb(NEON_COLORS[3])),
        ));
        const neonCol = neonHue.mul(2.4).mul(u.pierGlow).mul(u.pierPower.mul(0.8).add(0.2));
        // The sign's face: deep navy enamel, lit pink by its own neon.
        const signCol = rgb(0x1c2c52).mul(sky.add(rgb(0xff4fa0, 0.25).mul(u.pierGlow).mul(u.pierPower))).add(rim.mul(0.5));

        return select(kind.lessThan(0.5), timberCol, select(
            kind.lessThan(1.5),
            paintCol,
            select(kind.lessThan(2.5), wallCol, select(
                kind.lessThan(3.5),
                domeCol,
                select(kind.lessThan(4.5), neonCol, signCol),
            )),
        ));
    })();
    return material;
}

/** The bulbs: railing strings, garlands between the lamps, lamp globes, the arch, the domes. */
function pierBulbs(frame, lamps, domes, pylon, head) {
    const rows = [];
    const { deckY, width } = PIER;
    const half = width / 2;
    const L = frame.length;
    const warm = linearColor(0xffd88a);
    const pink = linearColor(0xff6fae);
    const mint = linearColor(0x7ff0d4);
    const lemon = linearColor(0xffe46a);
    const along = (s) => s / L;

    // The pier head: a string round its railing, globes on its corner lamps.
    let hi = 0;
    head.edges.forEach(([[sa, ca], [sb, cb]]) => {
        const n = Math.max(1, Math.round(Math.hypot(sb - sa, cb - ca)));
        for (let k = 0; k <= n; k += 1) {
            const f = k / n;
            rows.push({
                p: frame.at(sa + (sb - sa) * f, ca + (cb - ca) * f, deckY + 1.32),
                size: 0.24,
                color: hi % 4 === 3 ? pink : warm,
                program: BULB.chase,
                index: hi,
                count: 120,
                along: 0.02,
                level: 0.95,
            });
            hi += 1;
        }
    });
    head.lamps.forEach((lp) => rows.push({
        p: frame.at(lp.s, lp.c, lp.h), size: 0.62, color: linearColor(0xfff0e0), program: BULB.globe, along: 0.02, level: 1.2,
    }));

    // Railing strings on both rails (the near one brighter), every metre.
    for (const [c, level] of [[half - 0.15, 1.0], [-half + 0.15, 0.7]]) {
        let i = 0;
        for (let s = PIER_HEAD.s1 + 0.6; s < L - 0.6; s += 1.0) {
            const color = i % 4 === 3 ? pink : warm;
            rows.push({
                p: frame.at(s, c, deckY + 1.32), size: 0.24, color, program: BULB.steady, index: i, count: 160, along: along(s), level,
            });
            i += 1;
        }
    }
    // Garlands swagged between neighbouring lamp tops on the near side, and the globes.
    lamps.forEach((lp, k) => {
        rows.push({
            p: frame.at(lp.s, lp.c, lp.h), size: 0.62, color: linearColor(0xfff0e0), program: BULB.globe, along: along(lp.s), level: 1.2,
        });
        const next = lamps[k + 2];
        if (!next) return;
        const a = frame.at(lp.s, lp.c, lp.h - 0.3);
        const b = frame.at(next.s, next.c, next.h - 0.3);
        const n = 22;
        for (let j = 1; j < n; j += 1) {
            const f = j / n;
            const pnt = a.clone().lerp(b, f);
            pnt.y -= Math.sin(f * Math.PI) * 1.3;
            const color = [pink, mint, lemon, warm][j % 4];
            rows.push({
                p: pnt, size: 0.22, color, program: BULB.chase, index: k * n + j, count: lamps.length * n, along: along(pnt.clone().sub(frame.far).dot(frame.along)), level: 0.9,
            });
        }
    });
    // The pylon: a chase down its face and a starburst round the ball on top.
    const { P, crown } = pylon;
    const pylonAlong = along(PYLON.s);
    for (let k = 0; k < 26; k += 1) {
        rows.push({
            p: P(0, 1.8 + k * ((PYLON.height - 2.6) / 25), PYLON.depth / 2 + 0.2),
            size: 0.34,
            color: k % 2 ? warm : lemon,
            program: BULB.chase,
            index: 25 - k,
            count: 26,
            along: pylonAlong,
            level: 1.1,
        });
    }
    rows.push({
        p: crown, size: 1.1, color: linearColor(0xfff0e0), program: BULB.globe, along: pylonAlong, level: 1.3,
    });
    for (let r = 0; r < 12; r += 1) {
        const a = (r / 12) * Math.PI * 2;
        for (let j = 1; j <= 2; j += 1) {
            const d = 1.15 + j * 0.45;
            rows.push({
                p: crown.clone().addScaledVector(pylon.basisX, Math.cos(a) * d).add(new THREE.Vector3(0, Math.sin(a) * d, 0)),
                size: 0.3,
                color: j % 2 ? pink : lemon,
                program: BULB.chase,
                index: j,
                count: 3,
                along: pylonAlong,
                level: 1.0,
            });
        }
    }
    // Domes: eight ribs of bulbs and a bulb on the finial; the cornice outlined.
    domes.forEach((d) => {
        for (let rib = 0; rib < 8; rib += 1) {
            const a = (rib / 8) * Math.PI * 2;
            d.profile.forEach(([r, h], j) => {
                if (j === 0) return;
                rows.push({
                    p: d.base.clone().add(new THREE.Vector3(Math.cos(a) * (r + 0.12), h, Math.sin(a) * (r + 0.12))),
                    size: 0.24,
                    color: rib % 2 ? warm : mint,
                    program: BULB.chase,
                    index: rib * 8 + j,
                    count: 64,
                    along: along(d.pv.s),
                    level: 0.9,
                });
            });
        }
        rows.push({
            p: d.tip, size: 0.4, color: pink, program: BULB.sparkle, along: along(d.pv.s), level: 1.2,
        });
        // The cornice: a string of bulbs round the roof's edge.
        const { along: la, across: lc } = d.pv;
        const s0 = d.pv.s - la / 2 - 0.4;
        const c0 = -lc / 2 - 0.4;
        const corners = [[s0, c0], [s0 + la + 0.8, c0], [s0 + la + 0.8, c0 + lc + 0.8], [s0, c0 + lc + 0.8]];
        const top = PIER.deckY + d.pv.height + 0.55;
        let k = 0;
        corners.forEach(([sa, ca], e) => {
            const [sb, cb] = corners[(e + 1) % 4];
            const n = Math.max(2, Math.round(Math.hypot(sb - sa, cb - ca) / 0.9));
            for (let j = 0; j < n; j += 1) {
                const f = j / n;
                rows.push({
                    p: frame.at(sa + (sb - sa) * f, ca + (cb - ca) * f, top), size: 0.22, color: warm, program: BULB.steady, index: k, count: 40, along: along(d.pv.s), level: 0.9,
                });
                k += 1;
            }
        });
    });
    return rows;
}

/**
 * @param {object} u  world uniforms
 * @param {object} [opts]
 * @param {number} [opts.mirrorLayer]
 * @returns {THREE.Group}
 */
export function createPier(u, opts = {}) {
    const frame = pierFrame();
    const {
        out, lamps, domes, pylon, head,
    } = buildPier(frame);
    pylon.basisX = pylonFrame(frame).basis.x;
    const group = new THREE.Group();
    group.name = 'SynthwavePier';
    const structure = new THREE.Mesh(toGeometry(out, 'aPier'), createPierMaterial(u));
    structure.name = 'SynthwavePierStructure';
    structure.renderOrder = -7;
    structure.frustumCulled = false;
    const bulbs = createBulbField(u, pierBulbs(frame, lamps, domes, pylon, head), { name: 'SynthwavePierBulbs', mirrorLayer: opts.mirrorLayer });
    group.add(structure, bulbs);
    if (Number.isInteger(opts.mirrorLayer)) structure.layers.enable(opts.mirrorLayer);
    group.userData.meshes = [structure, bulbs];
    return group;
}

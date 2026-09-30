import { describe, expect, it } from 'vitest';

import {
    CAM_REST,
    CROWN_CAP_Y,
    DEFAULT_LAYOUT,
    DEFAULT_STONE_PROFILE,
    DOG_AZ,
    E,
    FALLBACK_RECT,
    ICE_N_EFF,
    MEASURED_VIEWPORTS,
    MOTE_PLANE_DEPTH,
    PILLAR,
    R,
    R22,
    S,
    STATION_COUNT,
    STONE,
    TAN_V,
    U,
    VFOV_DEG,
    cardFromBoard,
    dirToScreen,
    laneAnchors,
    outerLaneAz,
    phiToScreenY,
    projectWorld,
    ringDir,
    ringPoint,
    rowToPhi,
    screenToDir,
    screenToWorld55,
    solveStone,
    stationPhi,
    tanH,
    writePillarPlaces,
} from '../../src/playground/effects/parhelion-composition.js';

/**
 * Parhelion composition guards (§2.2, §2.4, §7.3, §15 addendum). The board card is the
 * product: the halo display frames it, the Vigil Stone backs it, and nothing reactive may
 * spawn on it. Every assertion runs at all six measured DOM viewports, through an
 * independent pinhole camera and an independent ray-vs-stone oracle, so the module's own
 * projection helpers are checked rather than trusted.
 */

const DEG = Math.PI / 180;

// §2.5 breathing extremes, hard-coded so a module edit cannot quietly shrink them.
const SPEC_BREATH = Object.freeze({
    yaw: 0.20 * DEG,
    pitch: 0.15 * DEG,
    x: 0.4,
    y: 0.3,
});

// §12: the stone covers the card plus at least 1° of arc.
const COVER_MARGIN = 1.0 * DEG;

// Sundog core footprint from ph_dogs (§5.0), e^-1 contour: inner Gaussian 0.0085 rad plus the
// 0.0064 rad chromatic shift of the innermost channel; tail side 0.02; vertical 0.034.
const DOG_CORE_INNER = 0.0085 + 0.0064;
const DOG_CORE_OUTER = 0.02;
const DOG_CORE_HALF_HEIGHT = 0.034;

// ph_halo's innermost HDR edge: red channel at R22 − 0.006, 0.0105 rad inner Gaussian.
const RING_INNER_EDGE = R22 - 0.006 - 0.0105;

const REST_POSE = Object.freeze({
    yaw: 0, pitch: 0, x: 0, y: 0,
});

/** Rest pose plus all 16 sign combinations of the four breathing extremes. */
const POSES = [REST_POSE];
for (let mask = 0; mask < 16; mask++) {
    POSES.push(Object.freeze({
        yaw: (mask & 1 ? 1 : -1) * SPEC_BREATH.yaw,
        pitch: (mask & 2 ? 1 : -1) * SPEC_BREATH.pitch,
        x: (mask & 4 ? 1 : -1) * SPEC_BREATH.x,
        y: (mask & 8 ? 1 : -1) * SPEC_BREATH.y,
    }));
}

function label(vp) {
    return `${vp.width}x${vp.height}`;
}

function vec(x, y, z) {
    return { x, y, z };
}

function normalize(v) {
    const inv = 1 / Math.hypot(v.x, v.y, v.z);
    return vec(v.x * inv, v.y * inv, v.z * inv);
}

function dirFromAzEl(az, el) {
    return vec(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
}

// ---------------------------------------------------------------------------------------
// Independent pinhole camera (three's 'YXZ' order: rotation.y = yaw, rotation.x = E + pitch)
// ---------------------------------------------------------------------------------------

function makeCamera(aspect, pose = REST_POSE) {
    const el = E + pose.pitch;
    const cy = Math.cos(pose.yaw);
    const sy = Math.sin(pose.yaw);
    const ce = Math.cos(el);
    const se = Math.sin(el);
    const tanV = Math.tan((VFOV_DEG * DEG) / 2);
    return {
        tanV,
        tanH: tanV * aspect,
        pos: vec(0 + pose.x, 25 + pose.y, 0),
        fwd: vec(-ce * sy, se, -ce * cy),
        right: vec(cy, 0, -sy),
        up: vec(se * sy, ce, se * cy),
    };
}

function cameraRay(cam, sx, sy) {
    const tx = (sx * 2 - 1) * cam.tanH;
    const ty = (1 - sy * 2) * cam.tanV;
    return normalize(vec(
        cam.fwd.x + tx * cam.right.x + ty * cam.up.x,
        cam.fwd.y + tx * cam.right.y + ty * cam.up.y,
        cam.fwd.z + tx * cam.right.z + ty * cam.up.z,
    ));
}

function projectDir(cam, d) {
    const cz = d.x * cam.fwd.x + d.y * cam.fwd.y + d.z * cam.fwd.z;
    const cx = d.x * cam.right.x + d.y * cam.right.y + d.z * cam.right.z;
    const cy = d.x * cam.up.x + d.y * cam.up.y + d.z * cam.up.z;
    return {
        x: 0.5 + (0.5 * cx) / (cz * cam.tanH),
        y: 0.5 - (0.5 * cy) / (cz * cam.tanV),
        depth: cz,
    };
}

function projectPoint(cam, p) {
    return projectDir(cam, vec(p.x - cam.pos.x, p.y - cam.pos.y, p.z - cam.pos.z));
}

/** Great-circle step of `angle` from `dir` toward the screen direction (ox right, oy up). */
function pushOutward(cam, dir, ox, oy, angle) {
    const o = vec(
        ox * cam.right.x + oy * cam.up.x,
        ox * cam.right.y + oy * cam.up.y,
        ox * cam.right.z + oy * cam.up.z,
    );
    const along = o.x * dir.x + o.y * dir.y + o.z * dir.z;
    const t = normalize(vec(o.x - along * dir.x, o.y - along * dir.y, o.z - along * dir.z));
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return vec(dir.x * c + t.x * s, dir.y * c + t.y * s, dir.z * c + t.z * s);
}

// ---------------------------------------------------------------------------------------
// Independent stone oracle: stacked elliptic slabs (one per profile band), leaned by an
// object rotation.z = −LEAN about the base, flat-topped at the shoulder (the rounded crown
// above it is ignored, which only under-states coverage). Band 0 continues below the snow line: the
// base is buried, so a low ray is backed by the stone or by the snow in front of it.
// ---------------------------------------------------------------------------------------

function stoneBlocks(solve, profile, origin, dir) {
    const cl = Math.cos(STONE.LEAN);
    const sl = Math.sin(STONE.LEAN);
    const pz = origin.z - STONE.Z;
    const ox = origin.x * cl - origin.y * sl;
    const oy = origin.x * sl + origin.y * cl;
    const dx = dir.x * cl - dir.y * sl;
    const dy = dir.x * sl + dir.y * cl;
    const bandH = solve.shoulderH / STONE.BANDS;
    for (let i = 0; i < STONE.BANDS; i++) {
        const a = solve.sx * profile[i];
        const b = a * STONE.DEPTH_SCALE;
        const qa = (dx * dx) / (a * a) + (dir.z * dir.z) / (b * b);
        const qb = 2 * ((ox * dx) / (a * a) + (pz * dir.z) / (b * b));
        const qc = (ox * ox) / (a * a) + (pz * pz) / (b * b) - 1;
        const disc = qb * qb - 4 * qa * qc;
        if (disc < 0) continue;
        const t0 = Math.max(0, (-qb - Math.sqrt(disc)) / (2 * qa));
        const t1 = (-qb + Math.sqrt(disc)) / (2 * qa);
        if (t1 <= 0) continue;
        const ya = oy + t0 * dy;
        const yb = oy + t1 * dy;
        const lo = i === 0 ? -Infinity : i * bandH;
        const hi = (i + 1) * bandH;
        if (Math.max(Math.min(ya, yb), lo) <= Math.min(Math.max(ya, yb), hi)) return true;
    }
    return false;
}

/** Card boundary samples with their outward screen normals (corners: both edges + diagonal). */
function cardBoundarySamples(card, perEdge = 24) {
    const samples = [];
    const diag = Math.SQRT1_2;
    for (let i = 1; i < perEdge; i++) {
        const f = i / perEdge;
        const x = card.x0 + f * (card.x1 - card.x0);
        const y = card.y0 + f * (card.y1 - card.y0);
        samples.push({
            x, y: card.y0, ox: 0, oy: 1,
        });
        samples.push({
            x, y: card.y1, ox: 0, oy: -1,
        });
        samples.push({
            x: card.x0, y, ox: -1, oy: 0,
        });
        samples.push({
            x: card.x1, y, ox: 1, oy: 0,
        });
    }
    for (const [x, sxn] of [[card.x0, -1], [card.x1, 1]]) {
        for (const [y, syn] of [[card.y0, 1], [card.y1, -1]]) {
            samples.push({
                x, y, ox: sxn, oy: 0,
            });
            samples.push({
                x, y, ox: 0, oy: syn,
            });
            samples.push({
                x, y, ox: sxn * diag, oy: syn * diag,
            });
        }
    }
    return samples;
}

function outsideRect(p, r) {
    return p.x < r.x0 || p.x > r.x1 || p.y < r.y0 || p.y > r.y1;
}

/** Signed clearance of a point from a rect: > 0 outside, ≤ 0 inside (Chebyshev-style). */
function rectClearance(p, r) {
    const dx = Math.max(r.x0 - p.x, p.x - r.x1);
    const dy = Math.max(r.y0 - p.y, p.y - r.y1);
    return Math.max(dx, dy);
}

function expectOutsideCard(scr, vp, what, stats) {
    const c = rectClearance(scr, vp.card);
    stats.min = Math.min(stats.min, c);
    expect(c, `${label(vp)} ${what}`).toBeGreaterThan(0);
}

function dogFootprint(side) {
    const points = [];
    for (let i = 0; i <= 8; i++) {
        const az = DOG_AZ - DOG_CORE_INNER + ((DOG_CORE_INNER + DOG_CORE_OUTER) * i) / 8;
        for (let j = 0; j <= 8; j++) {
            const el = E - DOG_CORE_HALF_HEIGHT + (2 * DOG_CORE_HALF_HEIGHT * j) / 8;
            points.push(dirFromAzEl(side * az, el));
        }
    }
    return points;
}

function solveFor(vp) {
    return solveStone({ card: vp.card, aspect: vp.aspect });
}

/** Height of a camera ray where it crosses the slab-centre plane, in the stone's un-leaned frame. */
function rayLocalHeight(cam, ray) {
    const t = (STONE.Z - cam.pos.z) / ray.z;
    const wx = cam.pos.x + ray.x * t;
    const wy = cam.pos.y + ray.y * t;
    return wx * Math.sin(STONE.LEAN) + wy * Math.cos(STONE.LEAN);
}

/** The leaned crown peak in world space. */
function crownPoint(solve) {
    const cx = STONE.UNIT_CROWN_X * solve.sx;
    return {
        x: cx * Math.cos(STONE.LEAN) + solve.crownH * Math.sin(STONE.LEAN),
        y: -cx * Math.sin(STONE.LEAN) + solve.crownH * Math.cos(STONE.LEAN),
        z: STONE.Z,
    };
}

describe('Parhelion frame constants (§2.2)', () => {
    it('pins the rest camera to the sun: E 9.5°, vFOV in the 45–47° band, camera at (0, 25, 0)', () => {
        expect(E).toBeCloseTo(9.5 * DEG, 12);
        expect(VFOV_DEG).toBeGreaterThanOrEqual(45);
        expect(VFOV_DEG).toBeLessThanOrEqual(47);
        expect(CAM_REST).toEqual({ x: 0, y: 25, z: 0 });
        // The spec prints the basis to 6 places.
        expect(S.y).toBeCloseTo(0.165047, 5);
        expect(S.z).toBeCloseTo(-0.986286, 5);
        expect(U.y).toBeCloseTo(0.986286, 5);
        expect(U.z).toBeCloseTo(0.165047, 5);
        expect(R).toEqual({ x: 1, y: 0, z: 0 });
        expect(TAN_V).toBeCloseTo(Math.tan((VFOV_DEG * DEG) / 2), 12);
        expect(R22).toBeCloseTo(0.383972, 6);
        // Plate-crystal minimum deviation at the Bravais effective index.
        expect(ICE_N_EFF).toBeCloseTo(1.31763, 4);
        expect(DOG_AZ).toBeCloseTo(2 * Math.asin(ICE_N_EFF / 2) - Math.PI / 3, 3);
        expect(DOG_AZ).toBeCloseTo(22.414 * DEG, 5);
    });

    it('places the sun, ring, sundogs, horizon and pillar bases where the 16:9 and 2:1 frames say', () => {
        const out = { x: 0, y: 0, depth: 0 };
        const wide = 16 / 9;
        const twoOne = 1584 / 787;
        dirToScreen(S, wide, out);
        expect(out.x).toBeCloseTo(0.5, 12);
        expect(out.y).toBeCloseTo(0.5, 12);

        const ring = { x: 0, y: 0, z: 0 };
        ringDir(0, ring);
        expect(dirToScreen(ring, wide, out).x).toBeCloseTo(0.768, 3);
        expect(out.y).toBeCloseTo(0.5, 9);
        // The 2:1 column of the §2.2 table is quoted to ±0.001.
        expect(Math.abs(dirToScreen(ring, twoOne, out).x - 0.736)).toBeLessThan(0.001);
        ringDir(Math.PI / 2, ring);
        expect(dirToScreen(ring, wide, out).y).toBeCloseTo(0.024, 3);
        expect(phiToScreenY(Math.PI / 2)).toBeCloseTo(out.y, 9);

        dirToScreen(dirFromAzEl(DOG_AZ, E), wide, out);
        expect(out.x).toBeCloseTo(0.769, 3);
        expect(out.y).toBeCloseTo(0.484, 3);
        dirToScreen(dirFromAzEl(-DOG_AZ, E), wide, out);
        expect(out.x).toBeCloseTo(0.231, 3);
        expect(Math.abs(dirToScreen(dirFromAzEl(DOG_AZ, E), twoOne, out).x - 0.737)).toBeLessThan(0.001);

        expect(dirToScreen(dirFromAzEl(0.3, 0), wide, out).y).toBeCloseTo(0.697, 3);

        const places = writePillarPlaces(wide, new Float32Array(PILLAR.COUNT * 4));
        projectWorld({ x: places[4], y: 0, z: places[5] }, wide, out);
        expect(out.y).toBeCloseTo(0.884, 3);
    });

    it('round-trips screen ↔ direction ↔ world through the rest camera without allocating', () => {
        const dir = { x: 0, y: 0, z: 0 };
        const scr = { x: 0, y: 0, depth: 0 };
        const world = { x: 0, y: 0, z: 0 };
        for (const vp of MEASURED_VIEWPORTS) {
            for (const [sx, sy] of [[0.1, 0.2], [0.5, 0.5], [0.83, 0.91], [0.03, 0.97]]) {
                expect(screenToDir(sx, sy, vp.aspect, dir)).toBe(dir);
                expect(Math.hypot(dir.x, dir.y, dir.z)).toBeCloseTo(1, 12);
                expect(dirToScreen(dir, vp.aspect, scr)).toBe(scr);
                expect(scr.x).toBeCloseTo(sx, 9);
                expect(scr.y).toBeCloseTo(sy, 9);

                expect(screenToWorld55(sx, sy, vp.aspect, world)).toBe(world);
                expect(projectWorld(world, vp.aspect, scr)).toBe(scr);
                expect(scr.x).toBeCloseTo(sx, 9);
                expect(scr.y).toBeCloseTo(sy, 9);
                expect(scr.depth).toBeCloseTo(MOTE_PLANE_DEPTH, 9);

                // The module's pinhole agrees with the independent test camera.
                const ref = projectPoint(makeCamera(vp.aspect), world);
                expect(ref.x).toBeCloseTo(sx, 9);
                expect(ref.y).toBeCloseTo(sy, 9);
            }
        }
    });

    it('puts ring points on the 22° cone and on the mote plane', () => {
        const p = { x: 0, y: 0, z: 0 };
        const scr = { x: 0, y: 0, depth: 0 };
        for (let k = 0; k < STATION_COUNT; k++) {
            const phi = stationPhi(k);
            expect(ringPoint(phi, MOTE_PLANE_DEPTH, p)).toBe(p);
            const d = normalize(vec(p.x - CAM_REST.x, p.y - CAM_REST.y, p.z - CAM_REST.z));
            expect(Math.acos(d.x * S.x + d.y * S.y + d.z * S.z)).toBeCloseTo(R22, 9);
            expect(projectWorld(p, 16 / 9, scr).depth).toBeCloseTo(MOTE_PLANE_DEPTH, 9);
            expect(scr.y).toBeCloseTo(phiToScreenY(phi), 9);
        }
    });
});

describe('Parhelion measured layouts (§15 addendum)', () => {
    it('carries all six measured viewports with the card as the default stone target', () => {
        expect(MEASURED_VIEWPORTS.map(label)).toEqual([
            '1920x1080', '1680x1050', '2560x1080', '1584x787', '1366x768', '1280x800',
        ]);
        expect(DEFAULT_LAYOUT.card).toEqual({
            x0: 0.4089, y0: 0.1542, x1: 0.5911, y1: 0.8597,
        });
        expect(DEFAULT_LAYOUT.aspect).toBeCloseTo(16 / 9, 12);
        expect(FALLBACK_RECT).toEqual({
            x0: 0.36, y0: 0.08, x1: 0.64, y1: 0.94,
        });
        for (const vp of MEASURED_VIEWPORTS) {
            // The board canvas and the next queue sit inside the card; the HUD sits right of it.
            for (const inner of [vp.board, vp.next]) {
                expect(inner.x0).toBeGreaterThanOrEqual(vp.card.x0);
                expect(inner.x1).toBeLessThanOrEqual(vp.card.x1);
                expect(inner.y0).toBeGreaterThanOrEqual(vp.card.y0);
                expect(inner.y1).toBeLessThanOrEqual(vp.card.y1);
            }
            expect(vp.hud.x0).toBeGreaterThan(vp.card.x1);
        }
    });

    it('derives a card from the board canvas when the card is absent', () => {
        const out = {};
        expect(cardFromBoard(DEFAULT_LAYOUT.board, out)).toBe(out);
        expect(out.x0).toBeCloseTo(0.4084, 6);
        expect(out.y0).toBeCloseTo(0.1619, 6);
        expect(out.x1).toBeCloseTo(0.5947, 6);
        expect(out.y1).toBeCloseTo(0.8575, 6);
    });
});

describe('Parhelion keeps the card clear (§7.3, §12)', () => {
    it('keeps the ring at the sun\'s height, including its inner HDR edge, outside the card', () => {
        const scr = { x: 0, y: 0, depth: 0 };
        for (const vp of MEASURED_VIEWPORTS) {
            for (const phi of [0, Math.PI]) {
                const d = { x: 0, y: 0, z: 0 };
                ringDir(phi, d);
                expect(outsideRect(dirToScreen(d, vp.aspect, scr), vp.card), label(vp)).toBe(true);
                // The innermost glowing edge of the ring, same side.
                const side = phi === 0 ? 1 : -1;
                const inner = vec(
                    side * Math.sin(RING_INNER_EDGE),
                    S.y * Math.cos(RING_INNER_EDGE),
                    S.z * Math.cos(RING_INNER_EDGE),
                );
                expect(outsideRect(dirToScreen(inner, vp.aspect, scr), vp.card), label(vp)).toBe(true);
            }
        }
    });

    it('keeps both sundog cores outside the card at every breathing extreme', () => {
        for (const vp of MEASURED_VIEWPORTS) {
            for (const pose of POSES) {
                const cam = makeCamera(vp.aspect, pose);
                for (const side of [-1, 1]) {
                    for (const d of dogFootprint(side)) {
                        expect(outsideRect(projectDir(cam, d), vp.card), label(vp)).toBe(true);
                    }
                }
            }
        }
    });

    it('keeps all six pillar lanes outside the card over their whole on-screen height', () => {
        const places = new Float32Array(PILLAR.COUNT * 4);
        const scr = { x: 0, y: 0, depth: 0 };
        for (const vp of MEASURED_VIEWPORTS) {
            expect(writePillarPlaces(vp.aspect, places)).toBe(places);
            for (let lane = 0; lane < PILLAR.COUNT; lane++) {
                const x = places[lane * 4];
                const z = places[lane * 4 + 1];
                expect(places[lane * 4 + 2]).toBeCloseTo(PILLAR.WIDTH, 5);
                expect(places[lane * 4 + 3]).toBe(PILLAR.HEIGHT);
                expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(PILLAR.DIST - 1e-3);
                for (let h = 0; h <= PILLAR.HEIGHT; h += 5) {
                    for (const edge of [-0.5, 0.5]) {
                        const p = { x: x + edge * PILLAR.WIDTH, y: h, z };
                        projectWorld(p, vp.aspect, scr);
                        if (scr.y < 0 || scr.y > 1) continue;
                        expect(outsideRect(scr, vp.card), `${label(vp)} lane ${lane} h ${h}`).toBe(true);
                    }
                }
            }
        }
    });

    it('spawns stations, bead starts and lane motes only outside the card', () => {
        const scr = { x: 0, y: 0, depth: 0 };
        const p = { x: 0, y: 0, z: 0 };
        const lanes = { xL: 0, xR: 0 };
        const stats = { min: Infinity };
        for (const vp of MEASURED_VIEWPORTS) {
            for (let k = 0; k < STATION_COUNT; k++) {
                projectWorld(ringPoint(stationPhi(k), MOTE_PLANE_DEPTH, p), vp.aspect, scr);
                expectOutsideCard(scr, vp, `station ${k}`, stats);
            }
            expect(laneAnchors(vp.card, lanes)).toBe(lanes);
            expect(lanes.xL).toBeCloseTo(Math.max(0.03, vp.card.x0 * 0.45), 12);
            expect(lanes.xR).toBeCloseTo(Math.min(0.97, vp.card.x1 + 0.55 * (1 - vp.card.x1)), 12);
            for (let i = 0; i <= 20; i++) {
                const rowV = i / 20;
                const phi = rowToPhi(rowV, vp.board);
                for (const side of [phi, Math.PI - phi]) {
                    projectWorld(ringPoint(side, MOTE_PLANE_DEPTH, p), vp.aspect, scr);
                    expectOutsideCard(scr, vp, `bead start row ${rowV}`, stats);
                }
                const y = vp.board.y0 + rowV * (vp.board.y1 - vp.board.y0);
                for (const x of [lanes.xL, lanes.xR]) {
                    projectWorld(screenToWorld55(x, y, vp.aspect, p), vp.aspect, scr);
                    expectOutsideCard(scr, vp, `lane mote x ${x}`, stats);
                }
            }
        }
        // Tightest: the bottom-row bead starts on short windows (~0.008 of the width).
        expect(stats.min).toBeGreaterThan(0.005);
    });
});

describe('Parhelion ring mapping (§7.3)', () => {
    it('maps board rows to ring angles monotonically, top row high, bottom row low', () => {
        for (const vp of MEASURED_VIEWPORTS) {
            let prev = Infinity;
            for (let i = 0; i <= 40; i++) {
                const phi = rowToPhi(i / 40, vp.board);
                expect(phi, label(vp)).toBeLessThan(prev);
                expect(Math.abs(phi)).toBeLessThanOrEqual(Math.PI / 2);
                prev = phi;
            }
            expect(rowToPhi(0, vp.board)).toBeGreaterThan(0);
            expect(rowToPhi(1, vp.board)).toBeLessThan(0);
        }
    });

    it('is exact at the card mid-height: the ring point projects onto the row, on both sides', () => {
        const p = { x: 0, y: 0, z: 0 };
        const scr = { x: 0, y: 0, depth: 0 };
        for (const vp of MEASURED_VIEWPORTS) {
            const yMid = 0.5 * (vp.card.y0 + vp.card.y1);
            const rowV = (yMid - vp.board.y0) / (vp.board.y1 - vp.board.y0);
            const phi = rowToPhi(rowV, vp.board);
            // The card is centred on the sun, so its middle row sits near the ring's side.
            expect(Math.abs(phi)).toBeLessThan(3 * DEG);
            projectWorld(ringPoint(phi, MOTE_PLANE_DEPTH, p), vp.aspect, scr);
            expect(scr.y, label(vp)).toBeCloseTo(yMid, 9);
            const right = scr.x;
            projectWorld(ringPoint(Math.PI - phi, MOTE_PLANE_DEPTH, p), vp.aspect, scr);
            expect(scr.y).toBeCloseTo(yMid, 9);
            expect(scr.x).toBeCloseTo(1 - right, 9);
            // And through the independent camera.
            expect(projectPoint(makeCamera(vp.aspect), p).y).toBeCloseTo(yMid, 9);
        }
    });

    it('is exact at every row inside the ring and clamps rows beyond the ring top/bottom', () => {
        const { board } = DEFAULT_LAYOUT;
        for (let i = 0; i <= 20; i++) {
            const rowV = i / 20;
            const y = board.y0 + rowV * (board.y1 - board.y0);
            expect(phiToScreenY(rowToPhi(rowV, board))).toBeCloseTo(y, 9);
        }
        const tall = {
            x0: 0.4, y0: 0.0, x1: 0.6, y1: 1.0,
        };
        expect(rowToPhi(0, tall)).toBe(Math.PI / 2);
        expect(rowToPhi(1, tall)).toBe(-Math.PI / 2);
    });

    it('numbers 12 stations clockwise from the top', () => {
        expect(stationPhi(0)).toBeCloseTo(Math.PI / 2, 12);
        expect(stationPhi(3)).toBeCloseTo(0, 12);
        expect(stationPhi(6)).toBeCloseTo(-Math.PI / 2, 12);
        expect(stationPhi(9)).toBeCloseTo(Math.PI, 12);
        expect(stationPhi(12)).toBeCloseTo(stationPhi(0), 12);
        expect(stationPhi(-1)).toBeCloseTo(stationPhi(11), 12);
        for (let k = 0; k < STATION_COUNT; k++) {
            expect(stationPhi(k)).toBeGreaterThan(-Math.PI);
            expect(stationPhi(k)).toBeLessThanOrEqual(Math.PI);
        }
    });
});

describe('Parhelion outer lanes (§2.2, §5.6)', () => {
    it('follows min(30°, atan(0.86·tanH)) and keeps both outer pillars on screen', () => {
        const places = new Float32Array(PILLAR.COUNT * 4);
        const scr = { x: 0, y: 0, depth: 0 };
        const aspects = MEASURED_VIEWPORTS.map((vp) => vp.aspect).concat([4 / 3, 1, 9 / 16, 32 / 9]);
        for (const aspect of aspects) {
            const az = outerLaneAz(aspect);
            expect(az).toBeCloseTo(Math.min(30 * DEG, Math.atan(0.86 * tanH(aspect))), 12);
            writePillarPlaces(aspect, places);
            for (const lane of [2, 3]) {
                const x = places[lane * 4];
                const z = places[lane * 4 + 1];
                expect(Math.atan2(Math.abs(x), -z)).toBeCloseTo(az, 5);
                let onScreen = 0;
                for (let h = 0; h <= PILLAR.HEIGHT; h += 5) {
                    for (const edge of [-0.5, 0.5]) {
                        projectWorld({ x: x + edge * PILLAR.WIDTH, y: h, z }, aspect, scr);
                        if (scr.y < 0 || scr.y > 1) continue;
                        onScreen++;
                        expect(scr.x, `aspect ${aspect} lane ${lane}`).toBeGreaterThan(0.02);
                        expect(scr.x, `aspect ${aspect} lane ${lane}`).toBeLessThan(0.98);
                    }
                }
                expect(onScreen).toBeGreaterThan(0);
            }
        }
        expect(outerLaneAz(16 / 9)).toBeCloseTo(30 * DEG, 12);
    });

    it('keeps the echo spares beside the dogs, stepped outward away from the card', () => {
        const places = writePillarPlaces(16 / 9, new Float32Array(PILLAR.COUNT * 4));
        for (const [dog, spare] of [[0, 4], [1, 5]]) {
            const dx = places[spare * 4] - places[dog * 4];
            const dz = places[spare * 4 + 1] - places[dog * 4 + 1];
            expect(Math.hypot(dx, dz)).toBeCloseTo(PILLAR.SPARE_OFFSET, 5);
            expect(Math.abs(places[spare * 4])).toBeGreaterThan(Math.abs(places[dog * 4]));
        }
        expect(places[0]).toBeLessThan(0);
        expect(places[4]).toBeGreaterThan(0);
    });
});

describe('Parhelion Vigil Stone solver (§2.4)', () => {
    it('backs the card plus 1° of arc up to the (capped) shoulder at every viewport and extreme', () => {
        // Crown-cap rule: where the capped stone cannot reach the card top, the strip of card
        // above its shoulder sits over the dusky lens by design; everything below is backed.
        for (const vp of MEASURED_VIEWPORTS) {
            const solve = solveFor(vp);
            expect(solve.backed, label(vp)).toBe(true);
            const samples = cardBoundarySamples(vp.card);
            const misses = [];
            let skipped = 0;
            for (const pose of POSES) {
                const cam = makeCamera(vp.aspect, pose);
                for (const s of samples) {
                    const ray = pushOutward(cam, cameraRay(cam, s.x, s.y), s.ox, s.oy, COVER_MARGIN);
                    if (solve.capped && rayLocalHeight(cam, ray) > solve.shoulderH) {
                        skipped++;
                        // Only the card's top strip may be left over the lens.
                        expect(s.y, `${label(vp)} uncovered sample below the shoulder band`)
                            .toBeLessThan(solve.shoulderY + 0.02);
                    } else if (!stoneBlocks(solve, DEFAULT_STONE_PROFILE, cam.pos, ray)) {
                        misses.push(`${s.x.toFixed(3)},${s.y.toFixed(3)} (${s.ox},${s.oy})`);
                    }
                }
            }
            expect(misses.slice(0, 5), label(vp)).toEqual([]);
            if (!solve.capped) expect(skipped, label(vp)).toBe(0);
        }
    });

    it('never exposes the sun: the stone covers S and an 8° ring around it at every extreme', () => {
        for (const vp of MEASURED_VIEWPORTS) {
            const solve = solveFor(vp);
            for (const pose of POSES) {
                const cam = makeCamera(vp.aspect, pose);
                expect(stoneBlocks(solve, DEFAULT_STONE_PROFILE, cam.pos, S), label(vp)).toBe(true);
                for (let i = 0; i < 16; i++) {
                    const a = (i / 16) * Math.PI * 2;
                    const d = pushOutward(cam, S, Math.cos(a), Math.sin(a), 8 * DEG);
                    expect(stoneBlocks(solve, DEFAULT_STONE_PROFILE, cam.pos, d), label(vp)).toBe(true);
                }
            }
        }
    });

    it('fits within the widened [0.7, 1.6] clamps and fills uStoneHW from the profile', () => {
        for (const vp of MEASURED_VIEWPORTS) {
            const solve = solveFor(vp);
            expect(solve.sx).toBeGreaterThanOrEqual(STONE.DEFAULT_SX * STONE.SCALE_MIN);
            expect(solve.sx).toBeLessThanOrEqual(STONE.DEFAULT_SX * STONE.SCALE_MAX);
            expect(solve.sy).toBeGreaterThanOrEqual(STONE.DEFAULT_SY * STONE.SCALE_MIN);
            expect(solve.sy).toBeLessThanOrEqual(STONE.DEFAULT_SY * STONE.SCALE_MAX);
            expect(solve.coreHalfWidth).toBe(solve.sx);
            expect(solve.shoulderH).toBeCloseTo(solve.sy * STONE.UNIT_SHOULDER, 9);
            expect(solve.crownH).toBeCloseTo(solve.sy * STONE.UNIT_CROWN, 9);
            expect(solve.stoneHW).toHaveLength(4);
            expect(solve.stoneHW[0]).toBeCloseTo(solve.sx * DEFAULT_STONE_PROFILE[0], 9);
            expect(solve.stoneHW[1]).toBeCloseTo(
                solve.sx * 0.5 * (DEFAULT_STONE_PROFILE[5] + DEFAULT_STONE_PROFILE[6]),
                9,
            );
            expect(solve.stoneHW[2]).toBeCloseTo(solve.sx * DEFAULT_STONE_PROFILE[11], 9);
            expect(solve.stoneHW[3]).toBe(solve.shoulderH);
            expect(solve.stoneHW[0]).toBeGreaterThan(solve.stoneHW[2]);
        }
    });

    it('caps the crown under CROWN_CAP_Y at every viewport and extreme, ring top clear above it', () => {
        // Design rule: the ring top, the upper tangent arc and the crown of light stay visible
        // above the stone at every aspect, the short 2:1 / 1366 / 1280 windows included.
        const scr = { x: 0, y: 0, depth: 0 };
        expect(phiToScreenY(Math.PI / 2)).toBeLessThan(CROWN_CAP_Y - 0.05);
        for (const vp of MEASURED_VIEWPORTS) {
            const solve = solveFor(vp);
            const crown = crownPoint(solve);
            projectWorld(crown, vp.aspect, scr);
            expect(scr.y, label(vp)).toBeGreaterThanOrEqual(CROWN_CAP_Y);
            expect(solve.crownY, label(vp)).toBeCloseTo(scr.y, 9);
            for (const pose of POSES) {
                const cam = makeCamera(vp.aspect, pose);
                const p = projectPoint(cam, crown);
                expect(p.y, `${label(vp)} breathing`).toBeGreaterThanOrEqual(CROWN_CAP_Y - 1e-3);
                // The ring top (with its HDR body) keeps ≥ 0.05 of screen height above the crown.
                const top = projectDir(cam, ringDir(Math.PI / 2, vec(0, 0, 0)));
                expect(p.y - top.y, `${label(vp)} ring top clearance`).toBeGreaterThan(0.05);
            }
            // The shoulder never drops so low that the card's covered part shrinks away.
            expect(solve.shoulderY, label(vp)).toBeLessThan(0.21);
        }
    });

    it('reports the cap: capped where the card top is out of reach, uncapped for a short card', () => {
        for (const vp of MEASURED_VIEWPORTS) {
            const solve = solveFor(vp);
            expect(solve.capped, label(vp)).toBe(solve.requiredSy > solve.sy);
            expect(solve.sy).toBeLessThanOrEqual(solve.capSy + 1e-9);
        }
        const short = solveStone({
            card: {
                x0: 0.41, y0: 0.30, x1: 0.59, y1: 0.86,
            },
            aspect: 16 / 9,
        });
        expect(short.capped).toBe(false);
        expect(short.backed).toBe(true);
        expect(short.crownY).toBeGreaterThan(CROWN_CAP_Y);
    });

    it('widens for a narrower silhouette profile and shrinks to the clamp for a tiny card', () => {
        const base = solveStone({ card: DEFAULT_LAYOUT.card, aspect: 16 / 9 });
        const narrow = DEFAULT_STONE_PROFILE.map((v) => v * 0.9);
        const wider = solveStone({ card: DEFAULT_LAYOUT.card, aspect: 16 / 9, profile: narrow });
        expect(wider.sx).toBeCloseTo(base.sx / 0.9, 3);

        const tiny = solveStone({
            card: {
                x0: 0.49, y0: 0.45, x1: 0.51, y1: 0.55,
            },
            aspect: 16 / 9,
        });
        expect(tiny.backed).toBe(true);
        expect(tiny.sx).toBeCloseTo(STONE.DEFAULT_SX * STONE.SCALE_MIN, 9);
        expect(tiny.sy).toBeCloseTo(STONE.DEFAULT_SY * STONE.SCALE_MIN, 9);

        const bigger = solveStone({ card: DEFAULT_LAYOUT.card, aspect: 16 / 9, marginDeg: 3 });
        expect(bigger.sx).toBeGreaterThan(base.sx);
        // The crown cap already binds at 16:9, so a bigger margin cannot raise the stone (a wider
        // stone only nudges the leaned peak, hence the tolerance).
        expect(bigger.sy).toBeGreaterThan(base.sy - 0.1);
    });

    it('marks MP, off-centre and missing cards not stone-backed and keeps the default stone', () => {
        const duo = {
            x0: 0.16, y0: 0.13, x1: 0.84, y1: 0.87,
        };
        const offCentre = {
            x0: 0.2, y0: 0.2, x1: 0.35, y1: 0.8,
        };
        for (const card of [duo, offCentre, null]) {
            const solve = solveStone({ card, aspect: 16 / 9 });
            expect(solve.backed).toBe(false);
            expect(solve.sx).toBe(STONE.DEFAULT_SX);
            expect(solve.sy).toBe(STONE.DEFAULT_SY);
            expect(solve.shoulderH).toBeCloseTo(80, 9);
            expect(solve.capped).toBe(false);
        }
    });

    it('reuses the result object and defaults to the measured 16:9 card', () => {
        const out = solveStone();
        const again = solveStone({ card: MEASURED_VIEWPORTS[3].card, aspect: MEASURED_VIEWPORTS[3].aspect }, out);
        expect(again).toBe(out);
        expect(again.stoneHW).toBe(out.stoneHW);
        const fresh = solveStone({ card: DEFAULT_LAYOUT.card, aspect: DEFAULT_LAYOUT.aspect });
        expect(solveStone({}, out).sx).toBe(fresh.sx);
        expect(out.sy).toBe(fresh.sy);
    });
});

describe('Parhelion right sundog vs the HUD (§15.2, risk 4)', () => {
    it('keeps the right dog core clear of the HUD glass at every measured viewport and extreme', () => {
        const clearance = {};
        for (const vp of MEASURED_VIEWPORTS) {
            let min = Infinity;
            for (const pose of POSES) {
                const cam = makeCamera(vp.aspect, pose);
                for (const d of dogFootprint(1)) {
                    const p = projectDir(cam, d);
                    min = Math.min(min, rectClearance(p, vp.hud));
                }
            }
            clearance[label(vp)] = min;
            expect(min, label(vp)).toBeGreaterThan(0);
        }
        // vFOV 46° needs no tuning: the tightest fits clear by 0.0030 of the width at worst
        // breathing (1366×768, ~4 px; 7.6 px at rest) and 0.0050 at 1584×787. Only the faint
        // e^-4 tail grazes the glass edge there, and the HUD is a weak calm rect over glass.
        expect(Math.min(...Object.values(clearance))).toBeGreaterThan(0.0025);
    });
});

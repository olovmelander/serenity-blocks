/**
 * Sky Children — Irisfall: the frame (three-free).
 *
 * The eye stands still at the world origin (y up, 1 unit = 1 m) and looks toward −z. The sun is
 * BEHIND it, so the picture is composed round the ANTISOLAR point A: the bow is a circle round A,
 * the glory sits on it, the isles' shadows converge on it. A is not authored as a direction; it is
 * solved from the live layout (the card and the stats bar), so the bow's leg always stands in the
 * free zone left of the card and A sits low right of the HUD (or, on a phone, behind the card with
 * the bow as a smile under it).
 *
 *   fovForAspect(aspect)          the lens (Hor+)
 *   frameFor(aspect, layout, out) the solved frame: plan, lens, pitch, A, the bow's radii and the
 *                                 strokes the chain paints, the anchors the plan places things at
 *   project / unproject           the small camera model the solver and the tests share
 *
 * Screen positions are fractions of the frame, x right, y DOWN.
 */
import { DEG, clamp, smooth } from './sky-children-core.js';

export const REST_RIG = Object.freeze({ near: 0.3, far: 60000 });

/** Where the horizon sits in a landscape frame (fraction from the top). */
export const HORIZON_LANDSCAPE = 0.62;
/** Calm margin round the card and HUD a stroke must keep clear of. */
export const CALM_MARGIN = 0.015;
/** Strokes on the primary and secondary bows. */
export const PRIMARY_STROKES = 7;
export const SECONDARY_STROKES = 5;

/** The vertical field of view (degrees) for an aspect: 56° wide frames up to a 100° horizontal cap. */
export function fovForAspect(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    if (a < 1) {
        const v = (2 * Math.atan(Math.tan(17 * DEG) / a)) / DEG;
        return clamp(v, 56, 72);
    }
    const hfov = 2 * Math.atan(a * Math.tan(28 * DEG));
    if (hfov <= 100 * DEG) return 56;
    return (2 * Math.atan(Math.tan(50 * DEG) / a)) / DEG;
}

/** Camera basis for a yaw (about y) and a pitch (up positive), radians. */
export function cameraBasis(yaw, pitch, out = { f: [0, 0, -1], r: [1, 0, 0], u: [0, 1, 0] }) {
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    out.f[0] = -sy * cp; out.f[1] = sp; out.f[2] = -cy * cp;
    out.r[0] = cy; out.r[1] = 0; out.r[2] = -sy;
    // u = r × f
    out.u[0] = out.r[1] * out.f[2] - out.r[2] * out.f[1];
    out.u[1] = out.r[2] * out.f[0] - out.r[0] * out.f[2];
    out.u[2] = out.r[0] * out.f[1] - out.r[1] * out.f[0];
    return out;
}

/** A camera model: { basis, tanX, tanY, aspect, vfov, pitch, yaw }. */
export function cameraModel(aspect, vfovDeg, pitch, yaw = 0, out = {}) {
    out.aspect = aspect;
    out.vfov = vfovDeg;
    out.pitch = pitch;
    out.yaw = yaw;
    out.tanY = Math.tan((vfovDeg * DEG) / 2);
    out.tanX = out.tanY * aspect;
    out.basis = cameraBasis(yaw, pitch, out.basis);
    return out;
}

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Project a direction: { x, y } frame fractions (y down) and `front` (in front of the eye). */
export function project(dir, cam, out = { x: 0, y: 0, front: false }) {
    const { f, r, u } = cam.basis;
    const z = dot3(dir, f);
    out.front = z > 1e-6;
    const iz = 1 / Math.max(Math.abs(z), 1e-6);
    out.x = 0.5 + (0.5 * (dot3(dir, r) * iz)) / cam.tanX;
    out.y = 0.5 - (0.5 * (dot3(dir, u) * iz)) / cam.tanY;
    return out;
}

/** The unit direction through a frame point (x, y fractions, y down). */
export function unproject(x, y, cam, out = [0, 0, -1]) {
    const { f, r, u } = cam.basis;
    const px = (x - 0.5) * 2 * cam.tanX;
    const py = (0.5 - y) * 2 * cam.tanY;
    out[0] = f[0] + r[0] * px + u[0] * py;
    out[1] = f[1] + r[1] * px + u[1] * py;
    out[2] = f[2] + r[2] * px + u[2] * py;
    const l = Math.hypot(out[0], out[1], out[2]) || 1;
    out[0] /= l; out[1] /= l; out[2] /= l;
    return out;
}

/** Pitch that puts the horizon at frame height yh (fraction from the top). */
export function pitchForHorizon(yh, vfovDeg) {
    return Math.atan((yh - 0.5) * 2 * Math.tan((vfovDeg * DEG) / 2));
}

/**
 * The bow's basis round A: `down` points from A toward the circle's lowest point, `right` completes
 * it. A point at angular radius R and angle φ round A is
 *   cos R · A + sin R · (cos φ · down + sin φ · right)     (φ = 0 the bottom, φ = π the crest).
 */
export function bowBasis(A, out = { down: [0, -1, 0], right: [1, 0, 0] }) {
    // −Y minus its part along A.
    const k = -A[1];
    let dx = 0 - k * A[0];
    let dy = -1 - k * A[1];
    let dz = 0 - k * A[2];
    let l = Math.hypot(dx, dy, dz);
    if (l < 1e-6) { dx = 0; dy = 0; dz = 1; l = 1; }
    out.down[0] = dx / l; out.down[1] = dy / l; out.down[2] = dz / l;
    // right = down × A (so that, facing A, φ = +π/2 is to the right)
    const d = out.down;
    out.right[0] = d[1] * A[2] - d[2] * A[1];
    out.right[1] = d[2] * A[0] - d[0] * A[2];
    out.right[2] = d[0] * A[1] - d[1] * A[0];
    return out;
}

/** The direction at radius R (radians) and angle φ round A. */
export function bowPoint(A, basis, R, phi, out = [0, 0, 0]) {
    const cR = Math.cos(R);
    const sR = Math.sin(R);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    for (let i = 0; i < 3; i++) out[i] = cR * A[i] + sR * (c * basis.down[i] + s * basis.right[i]);
    return out;
}

/** The angle φ of a direction round A (inverse of bowPoint's φ). */
export function bowPhi(dir, A, basis) {
    const x = dot3(dir, basis.right);
    const y = dot3(dir, basis.down);
    return Math.atan2(x, y);
}

const insideRect = (p, r, m) => r && p.x > r.x0 - m && p.x < r.x1 + m && p.y > r.y0 - m && p.y < r.y1 + m;

/** True when a frame point is on screen and clear of every card and the HUD (plus a margin). */
export function clearOfCalm(p, layout, margin = CALM_MARGIN, edge = 0.002) {
    if (!p.front || p.x < -edge || p.x > 1 + edge || p.y < -edge || p.y > 1 + edge) return false;
    const cards = layout?.cards || [];
    for (let i = 0; i < cards.length; i++) if (insideRect(p, cards[i], margin)) return false;
    if (insideRect(p, layout?.hud, margin)) return false;
    return true;
}

function cardsUnion(layout) {
    const cards = layout?.cards || [];
    if (!cards.length) return null;
    const u = {
        x0: 1, y0: 1, x1: 0, y1: 0,
    };
    for (const c of cards) {
        u.x0 = Math.min(u.x0, c.x0); u.y0 = Math.min(u.y0, c.y0);
        u.x1 = Math.max(u.x1, c.x1); u.y1 = Math.max(u.y1, c.y1);
    }
    return u;
}

/** The leftmost card (by x0), or null. */
function leftCard(layout) {
    const cards = layout?.cards || [];
    let best = null;
    for (const c of cards) if (!best || c.x0 < best.x0) best = c;
    return best;
}

/**
 * The x (frame) where the circle of radius R round A crosses the horizon on the left, or null when
 * the circle does not reach the horizon in front of the eye.
 */
export function legCrossing(A, R, cam, scratch = { d: [0, 0, 0], p: { x: 0, y: 0, front: false } }) {
    const rho = Math.hypot(A[0], A[2]);
    const c = Math.cos(R) / Math.max(rho, 1e-6);
    if (Math.abs(c) > 1) return null;
    const phi0 = Math.atan2(A[2], A[0]);
    const delta = Math.acos(c);
    let best = null;
    for (const s of [-1, 1]) {
        const a = phi0 + s * delta;
        scratch.d[0] = Math.cos(a); scratch.d[1] = 0; scratch.d[2] = Math.sin(a);
        const p = project(scratch.d, cam, scratch.p);
        if (!p.front) continue;
        if (best === null || p.x < best) best = p.x;
    }
    return best;
}

const SAMPLE_STEP = 0.5 * DEG;

/**
 * The visible runs of a circle (radius R round A), going round from φ = start for a whole turn:
 * [{ phi0, phi1, len }] with phi increasing (unwrapped), len its on-screen length (frame-height units,
 * x scaled by the aspect).
 */
function visibleRuns(A, basis, R, cam, layout, start) {
    const runs = [];
    const d = [0, 0, 0];
    const p = { x: 0, y: 0, front: false };
    let run = null;
    let px = 0;
    let py = 0;
    const n = Math.ceil((2 * Math.PI) / SAMPLE_STEP);
    for (let i = 0; i <= n; i++) {
        const phi = start + i * SAMPLE_STEP;
        project(bowPoint(A, basis, R, phi, d), cam, p);
        const ok = clearOfCalm(p, layout);
        if (ok) {
            if (!run) {
                run = { phi0: phi, phi1: phi, len: 0 };
                runs.push(run);
            } else {
                run.len += Math.hypot((p.x - px) * cam.aspect, p.y - py);
                run.phi1 = phi;
            }
            px = p.x;
            py = p.y;
        } else {
            run = null;
        }
    }
    return runs.filter((r) => r.phi1 > r.phi0);
}

/** Cut `count` strokes of equal on-screen length along ordered runs (each run {phi0, phi1, len, dir}). */
function cutStrokes(runs, count, out) {
    const total = runs.reduce((s, r) => s + r.len, 0);
    out.length = 0;
    if (!(total > 0)) {
        for (let i = 0; i < count; i++) out.push({ phi0: 0, phi1: 0, len: 0 });
        return out;
    }
    const piece = total / count;
    // Walk the runs; a stroke that straddles a hidden gap keeps the gap (painted unseen).
    let runIndex = 0;
    let used = 0; // length used within the current run
    for (let i = 0; i < count; i++) {
        let need = piece;
        let startPhi = null;
        let endPhi = null;
        while (need > 1e-9 && runIndex < runs.length) {
            const r = runs[runIndex];
            const left = r.len - used;
            const take = Math.min(left, need);
            const f0 = r.len > 0 ? used / r.len : 0;
            const f1 = r.len > 0 ? (used + take) / r.len : 1;
            const a = r.dir > 0 ? r.phi0 + (r.phi1 - r.phi0) * f0 : r.phi1 - (r.phi1 - r.phi0) * f0;
            const b = r.dir > 0 ? r.phi0 + (r.phi1 - r.phi0) * f1 : r.phi1 - (r.phi1 - r.phi0) * f1;
            if (startPhi === null) startPhi = a;
            endPhi = b;
            need -= take;
            used += take;
            if (r.len - used <= 1e-9) {
                runIndex += 1;
                used = 0;
            }
        }
        out.push({ phi0: startPhi ?? 0, phi1: endPhi ?? 0, len: piece });
    }
    return out;
}

/**
 * Reading order for the landscape leg plan: from the left leg's horizon foot UP over the crest (φ
 * decreasing toward the crest on the left side is not assumed — the direction is found), then from
 * the foot DOWN through the Deep to the bottom edge.
 */
function legOrder(A, basis, R, cam, layout) {
    const d = [0, 0, 0];
    const p = { x: 0, y: 0, front: false };
    // Find the foot: the left crossing of the horizon (the leftmost on-screen sample with y ≈ horizon).
    let footPhi = null;
    let bestX = Infinity;
    let prevY = null;
    let prevPhi = 0;
    const n = Math.ceil((2 * Math.PI) / SAMPLE_STEP);
    for (let i = 0; i <= n; i++) {
        const phi = -Math.PI + i * SAMPLE_STEP;
        bowPoint(A, basis, R, phi, d);
        const el = d[1];
        if (prevY !== null && (prevY <= 0) !== (el <= 0)) {
            const t = prevY / (prevY - el);
            const ph = prevPhi + (phi - prevPhi) * t;
            project(bowPoint(A, basis, R, ph, d), cam, p);
            if (p.front && p.x < bestX) {
                bestX = p.x;
                footPhi = ph;
            }
        }
        prevY = el;
        prevPhi = phi;
    }
    if (footPhi === null) footPhi = Math.PI / 2;
    // Which way round is UP from the foot? Step a little each way and compare elevations.
    const up = bowPoint(A, basis, R, footPhi + 2 * SAMPLE_STEP, [0, 0, 0])[1] > 0 ? 1 : -1;
    // Runs going round from the foot in the up direction, for a whole turn.
    const signed = (phi) => footPhi + up * phi;
    const runs = [];
    let run = null;
    let px = 0;
    let py = 0;
    for (let i = 0; i <= n; i++) {
        const phi = signed(i * SAMPLE_STEP);
        project(bowPoint(A, basis, R, phi, d), cam, p);
        if (clearOfCalm(p, layout)) {
            if (!run) {
                run = {
                    a: phi, b: phi, len: 0, last: false,
                };
                runs.push(run);
            } else {
                run.len += Math.hypot((p.x - px) * cam.aspect, p.y - py);
                run.b = phi;
            }
            px = p.x;
            py = p.y;
        } else {
            run = null;
        }
    }
    const kept = runs.filter((r) => r.len > 0);
    // The run that ends where we started (just below the foot) is read from the foot down.
    const ordered = [];
    for (const r of kept) {
        const endsAtFoot = Math.abs(r.b - signed(n * SAMPLE_STEP)) < SAMPLE_STEP * 1.5;
        ordered.push({ r, down: endsAtFoot });
    }
    const upRuns = ordered.filter((o) => !o.down).map(({ r }) => toRun(r.a, r.b, r.len));
    const downRuns = ordered.filter((o) => o.down).map(({ r }) => toRun(r.b, r.a, r.len));
    return {
        runs: upRuns.concat(downRuns), upRuns, downRuns, footPhi, up,
    };
}

/** The shortest a stroke may be on screen (frame heights) before its group gives it away. */
const MIN_STROKE = 0.12;

/**
 * Cut strokes group by group (FINAL §5.2): each group gets its quota, cut into equal on-screen
 * lengths along its own runs, so no stroke ever straddles two groups. A group too short to give
 * each of its strokes MIN_STROKE passes its surplus on to the next group (the last one back to
 * the longest).
 */
function cutGroups(groups, quotas, out) {
    const lens = groups.map((runs) => runs.reduce((sum, r) => sum + r.len, 0));
    const q = quotas.slice();
    for (let g = 0; g < groups.length; g++) {
        const fit = Math.floor(lens[g] / MIN_STROKE + 1e-9);
        if (q[g] > fit) {
            const surplus = q[g] - fit;
            q[g] = fit;
            if (g + 1 < groups.length) {
                q[g + 1] += surplus;
            } else {
                let best = -1;
                lens.forEach((len, k) => { if (k !== g && (best < 0 || len > lens[best])) best = k; });
                if (best >= 0) q[best] += surplus; else q[g] += surplus;
            }
        }
    }
    out.length = 0;
    const scratch = [];
    groups.forEach((runs, g) => {
        if (q[g] <= 0) return;
        cutStrokes(runs, q[g], scratch);
        scratch.forEach((st) => out.push({ phi0: st.phi0, phi1: st.phi1, len: st.len }));
    });
    return out;
}

/** A run painted from phi `from` to phi `to`. */
function toRun(from, to, len) {
    return from <= to
        ? {
            phi0: from, phi1: to, len, dir: 1,
        }
        : {
            phi0: to, phi1: from, len, dir: -1,
        };
}

/** Smile order: segments left to right, read from the centre outward (centre, left, right, …). */
function smileOrder(A, basis, R, cam, layout, count, out) {
    const runs = visibleRuns(A, basis, R, cam, layout, -Math.PI);
    // Sort the visible arc left to right on screen.
    const d = [0, 0, 0];
    const p = { x: 0, y: 0, front: false };
    const asc = runs.map((r) => {
        const x0 = project(bowPoint(A, basis, R, r.phi0, d), cam, p).x;
        const x1 = project(bowPoint(A, basis, R, r.phi1, d), cam, p).x;
        return x0 <= x1 ? { ...r, dir: 1, xs: Math.min(x0, x1) } : { ...r, dir: -1, xs: Math.min(x0, x1) };
    }).sort((a, b) => a.xs - b.xs);
    const segs = cutStrokes(asc, count, []);
    // Reading order: centre, then alternate left/right outward.
    const mid = Math.floor(count / 2);
    const order = [mid];
    for (let k = 1; order.length < count; k++) {
        if (mid - k >= 0) order.push(mid - k);
        if (mid + k < count && order.length < count) order.push(mid + k);
    }
    out.length = 0;
    for (const i of order) out.push(segs[i]);
    return out;
}

/**
 * The smile (phones, rows of boards): the primary's radius (degrees), where its lowest point
 * stands in the strip under the cards (0 the cards' bottom, 1 the frame's), the secondary's gap
 * outside it (degrees, never less than minGap) and the lowest it may hang (frame y).
 */
export const SMILE = Object.freeze({
    R1: 34, low: 0.22, gap: 5.5, minGap: 4.5, floor: 0.985,
});

/** The glory's room round A (degrees): a four-line clear's rings, which must not leave the frame. */
const GLORY_ROOM = 5.6;
/** The crest stands at least this far inside the top edge (frame heights) when it is inside. */
const CREST_IN = 0.1;

/**
 * The crest of a circle round A as the frame shows it right of the cards: its top (frame y, below
 * zero when it leaves the frame), how much of the frame's width it runs along the top edge's band
 * (y in 0..0.08: a banner, not an arc), whether it crosses the top edge steeply (≥ 20°) wherever it
 * does, and its visible length (frame heights).
 */
function crestOf(A, R, cam, layout, union) {
    const basis = bowBasis(A, { down: [0, -1, 0], right: [1, 0, 0] });
    const d = [0, 0, 0];
    const p = { x: 0, y: 0, front: false };
    let top = Infinity;
    let banner = 0;
    let run = 0;
    let steep = true;
    let prev = null;
    for (let deg = 90; deg <= 270; deg += 0.5) {
        project(bowPoint(A, basis, R, deg * DEG, d), cam, p);
        const shows = p.front && p.x > union.x1 + CALM_MARGIN && p.x <= 1 && p.y < 0.7;
        if (!shows) {
            prev = null;
            continue;
        }
        top = Math.min(top, p.y);
        if (prev) {
            const dx = Math.abs(p.x - prev.x) * cam.aspect;
            const dy = Math.abs(p.y - prev.y);
            if (p.y >= 0 && p.y < 0.08) banner += Math.abs(p.x - prev.x);
            if (p.y >= 0 && prev.y >= 0) run += Math.hypot(dx, dy);
            if ((p.y < 0) !== (prev.y < 0) && Math.atan2(dy, dx) < 20 * DEG) steep = false;
        }
        prev = { x: p.x, y: p.y };
    }
    return {
        top: Number.isFinite(top) ? top : 1, banner, run, steep,
    };
}

/** Two stroke ends closer than this round A (radians) touch. */
const JOIN_TOLERANCE = 1 * DEG;
/** How far past an end the frame is looked at to see whether the end is hidden (radians). */
const END_PROBE = 1.5 * DEG;

/**
 * What each stroke's two ends meet, so the shader can ramp them (FINAL §5.2 strokes, the world's
 * writeStrokes): `joins[e]` the neighbour end that touches end e ({ k, end }: start-to-start at
 * the foot included, found by where the ends stand round A, not by table order) or null, and
 * `hides[e]` what lies just past an end that touches nothing: 0 open sky, 1 a card or the HUD,
 * 2 the frame's edge.
 */
function markEnds(strokes, A, basis, R, cam, layout) {
    const TAU = 2 * Math.PI;
    const d = [0, 0, 0];
    const p = { x: 0, y: 0, front: false };
    const phiOf = (s, e) => (e ? s.phi1 : s.phi0);
    strokes.forEach((s) => {
        s.joins = [null, null];
        s.hides = [0, 0];
    });
    strokes.forEach((s, k) => {
        if (!(Math.abs(s.phi1 - s.phi0) > 1e-6)) return;
        const sense = s.phi1 < s.phi0 ? -1 : 1;
        for (let e = 0; e < 2; e++) {
            let near = JOIN_TOLERANCE;
            strokes.forEach((o, j) => {
                if (j === k || !(Math.abs(o.phi1 - o.phi0) > 1e-6)) return;
                for (let f = 0; f < 2; f++) {
                    const gap = phiOf(s, e) - phiOf(o, f);
                    const apart = Math.abs(gap - TAU * Math.round(gap / TAU));
                    if (apart < near) {
                        near = apart;
                        s.joins[e] = { k: j, end: f };
                    }
                }
            });
            if (s.joins[e]) continue;
            const beyond = phiOf(s, e) + (e ? sense : -sense) * END_PROBE;
            project(bowPoint(A, basis, R, beyond, d), cam, p);
            if (clearOfCalm(p, layout, CALM_MARGIN, 0)) continue;
            const off = !p.front || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1;
            s.hides[e] = off ? 2 : 1;
        }
    });
    return strokes;
}

/** A fallback solo layout (fractions) for frames with no card on screen yet. */
export function nominalLayout(aspect) {
    if (aspect < 1) {
        // The phone's solo card fills most of the frame (390 × 844: x 0.164–0.836, y 0.146–0.854).
        return {
            cardCount: 1,
            cards: [{
                x0: 0.164, x1: 0.836, y0: 0.146, y1: 0.854,
            }],
            hud: null,
            boards: [],
        };
    }
    const W = 1600;
    const H = Math.round(W / Math.max(0.3, aspect));
    const board = Math.max(120, Math.min(Math.max(220, Math.min(0.22 * W, 300)), (H - 250) / 2));
    const cw = 1.19 * board;
    const ch = 2 * board + 158;
    const card = {
        x0: (W / 2 - cw / 2) / W, x1: (W / 2 + cw / 2) / W, y0: (H / 2 - ch / 2) / H, y1: (H / 2 + ch / 2) / H,
    };
    if (aspect < 1) {
        return {
            cardCount: 1, cards: [card], hud: null, boards: [],
        };
    }
    const stage = Math.min(Math.max(300, Math.min(0.35 * W, 400)), (H - 200) / 2);
    const hh = Math.min(385, H / 2);
    const hx0 = W / 2 + stage / 2 + 60;
    const hud = {
        x0: hx0 / W, x1: (hx0 + 140) / W, y0: (H / 2 - hh / 2) / H, y1: (H / 2 + hh / 2) / H,
    };
    return {
        cardCount: 1, cards: [card], hud, boards: [],
    };
}

/**
 * Solve the frame for an aspect and a layout (screen-fraction rects, or null → nominalLayout).
 * `out` is reused. Fields:
 *   plan 'leg' | 'smile', vfov (deg), pitch (rad), horizon (frame y), cam (camera model),
 *   A [x,y,z] (unit), basis {down,right}, R1, R2, Rfog (radians), strokes1[7], strokes2[5]
 *   ({ phi0, phi1, len }: painted from phi0 to phi1), gloryVisible, Ascreen {x,y}, foot {x,y}
 *   (where the primary leg meets the horizon), bearingScale (portrait compression).
 */
export function frameFor(aspect, layoutIn, out = {}) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const layout = layoutIn && layoutIn.cards?.length ? layoutIn : nominalLayout(a);
    const vfov = fovForAspect(a);
    const union = cardsUnion(layout) || {
        x0: 0.4, x1: 0.6, y0: 0.15, y1: 0.85,
    };
    const lc = leftCard(layout) || union;
    const hud = layout.hud || null;
    const right = Math.max(union.x1, hud ? hud.x1 : 0);
    const leftZone = lc.x0;
    const rightZone = 1 - right;
    out.vfov = vfov;
    out.aspect = a;
    out.A = out.A || [0, 0, -1];
    out.basis = out.basis || { down: [0, -1, 0], right: [1, 0, 0] };
    out.strokes1 = out.strokes1 || [];
    out.strokes2 = out.strokes2 || [];
    out.Ascreen = out.Ascreen || { x: 0, y: 0 };
    out.foot = out.foot || { x: 0, y: 0 };
    // The free margins beside the cards (and the HUD): the isles stand in them.
    out.free = out.free || { left: 0, right: 1 };
    out.free.left = union.x0;
    out.free.right = right;
    const setPlan = (smilePlan) => {
        out.plan = smilePlan ? 'smile' : 'leg';
        out.horizon = smilePlan ? 0.6 * union.y0 : HORIZON_LANDSCAPE;
        out.pitch = pitchForHorizon(out.horizon, vfov);
        out.cam = cameraModel(a, vfov, out.pitch, 0, out.cam || {});
        out.bearingScale = smilePlan ? 0.45 : 1;
        return out.cam;
    };
    let smile = a < 1 || leftZone < 0.2 || rightZone < 0.12;
    let cam = setPlan(smile);

    if (!smile) {
        // A low right of the HUD; the leg's foot near the preferred x inside the left free zone.
        const xPref = clamp(hud ? (hud.x0 + hud.x1) / 2 + 0.03 : right + 0.45 * (1 - right), right - 0.08, 0.93);
        const want = clamp(0.3 * (lc.x0 / 0.407), 0.16, Math.max(0.17, lc.x0 - 0.1));
        const at = (R) => legCrossing(out.A, R, cam) ?? 0;
        // R1 in [38°, 46°] putting the leg's foot at `want` (a larger radius moves it further left).
        const solveR1 = () => {
            let lo = 38 * DEG;
            let hi = 46 * DEG;
            if (at(lo) <= want) return lo;
            if (at(hi) >= want) return hi;
            for (let i = 0; i < 40; i++) {
                const mid = (lo + hi) / 2;
                if (at(mid) > want) lo = mid; else hi = mid;
            }
            return (lo + hi) / 2;
        };
        // Where A may stand, scored: the crest clearly inside the frame (never parked along the top
        // edge like a banner) or decisively out of it, room under the HUD and above the frame's
        // bottom for the glory, the foot where the plan wants it, room for the leg-up's two
        // strokes, A near the HUD's column.
        const room = GLORY_ROOM / vfov;
        let best = null;
        for (let ix = 0; ix <= 12; ix++) {
            const xA = clamp(xPref - ix * 0.01, right - 0.08, 0.93);
            if (ix > 0 && xA === clamp(xPref - (ix - 1) * 0.01, right - 0.08, 0.93)) break;
            for (let iy = 0; iy <= 11; iy++) {
                const yA = 0.83 + iy * 0.01;
                unproject(xA, yA, cam, out.A);
                const R = solveR1();
                const fx = legCrossing(out.A, R, cam);
                if (fx === null) continue;
                const crest = crestOf(out.A, R, cam, layout, union);
                // The leg-up group needs room for its two strokes before the card hides the arc.
                const legUp = legOrder(out.A, bowBasis(out.A, out.basis), R, cam, layout).upRuns[0]?.len ?? 0;
                let shape;
                if (crest.top >= CREST_IN) shape = Math.abs(crest.top - CREST_IN - 0.03) * 2;
                else if (crest.top <= -0.03 && crest.steep && crest.run >= 2 * MIN_STROKE) shape = 0.1;
                else shape = 1 + (CREST_IN - crest.top) * 4 + crest.banner;
                const cost = shape
                    + 3 * Math.max(0, yA + room - 0.985)
                    + 2 * Math.max(0, (hud ? hud.y1 : 0.6) + CALM_MARGIN + 0.05 - yA)
                    + 0.5 * Math.abs(xA - xPref)
                    + 2 * Math.abs(fx - want)
                    + 4 * Math.max(0, 2 * MIN_STROKE + 0.02 - legUp);
                if (!best || cost < best.cost - 1e-9) {
                    best = {
                        cost, xA, yA, R,
                    };
                }
            }
        }
        if (!best) {
            best = {
                xA: xPref, yA: 0.88, R: 42 * DEG,
            };
        }
        unproject(best.xA, best.yA, cam, out.A);
        out.R1 = best.R;
        out.R2 = out.R1 + 9 * DEG;
        out.Rfog = out.R1 - 3 * DEG;
        bowBasis(out.A, out.basis);
        // Primary: leg-up (the first run from the foot), crest (the rest going up), leg-down.
        const prim = legOrder(out.A, out.basis, out.R1, cam, layout);
        cutGroups([prim.upRuns.slice(0, 1), prim.upRuns.slice(1), prim.downRuns], [2, 3, 2], out.strokes1);
        // Secondary: up, then down.
        const sec = legOrder(out.A, out.basis, out.R2, cam, layout);
        cutGroups([sec.upRuns, sec.downRuns], [3, 2], out.strokes2);
        const fx = legCrossing(out.A, out.R1, cam);
        out.foot.x = fx ?? 0.25;
        out.foot.y = out.horizon;
        out.gloryVisible = true;
        // A leg that cannot reach the free zone left of the cards (a row of boards): the smile.
        if (fx === null || fx > lc.x0 - CALM_MARGIN) {
            smile = true;
            cam = setPlan(true);
        }
    }
    if (smile) {
        // A in the cards' centre column; its elevation puts the bow's lowest point just under the
        // card. The radius is art-directed (as the leg's is): a smaller circle curves visibly across
        // a narrow frame, its ends rising beside the card, where a 42° one would lie flat.
        const xA = (union.x0 + union.x1) / 2;
        out.R1 = SMILE.R1 * DEG;
        const yP = union.y1 + SMILE.low * (1 - union.y1);
        const lowAt = (yA, R) => {
            unproject(xA, yA, cam, out.A);
            bowBasis(out.A, out.basis);
            return project(bowPoint(out.A, out.basis, R, 0, [0, 0, 0]), cam).y;
        };
        let lo = -1.5;
        let hi = 0.95;
        for (let i = 0; i < 48; i++) {
            const mid = (lo + hi) / 2;
            // A higher on screen (smaller y) lifts the bow: lowest point moves up.
            if (lowAt(mid, out.R1) > yP) hi = mid; else lo = mid;
        }
        const yA = (lo + hi) / 2;
        unproject(xA, yA, cam, out.A);
        bowBasis(out.A, out.basis);
        // The secondary SMILE.gap out, so Alexander's dark band reads between them, drawn in (never
        // closer than SMILE.minGap) where its lowest point would leave the frame.
        const lowOf = (R) => project(bowPoint(out.A, out.basis, R, 0, [0, 0, 0]), cam).y;
        out.R2 = out.R1 + SMILE.gap * DEG;
        if (lowOf(out.R2) > SMILE.floor) {
            let rlo = out.R1 + SMILE.minGap * DEG;
            let rhi = out.R2;
            for (let i = 0; i < 40; i++) {
                const mid = (rlo + rhi) / 2;
                if (lowOf(mid) < SMILE.floor) rlo = mid; else rhi = mid;
            }
            out.R2 = rlo;
        }
        out.Rfog = out.R1 - 3 * DEG;
        smileOrder(out.A, out.basis, out.R1, cam, layout, PRIMARY_STROKES, out.strokes1);
        smileOrder(out.A, out.basis, out.R2, cam, layout, SECONDARY_STROKES, out.strokes2);
        out.foot.x = xA;
        out.foot.y = yP;
        out.gloryVisible = false;
    }
    markEnds(out.strokes1, out.A, out.basis, out.R1, cam, layout);
    markEnds(out.strokes2, out.A, out.basis, out.R2, cam, layout);
    const pA = project(out.A, cam);
    out.Ascreen.x = pA.x;
    out.Ascreen.y = pA.y;
    return out;
}

/** The sun's elevation (radians, above the horizon behind the eye) implied by A. */
export function sunElevation(frame) {
    return Math.asin(clamp(-frame.A[1], -1, 1));
}

/** A frame-height smoothstep helper for anchors that fade with how much free room there is. */
export function roomFor(width, need) {
    return smooth(need * 0.6, need, width);
}

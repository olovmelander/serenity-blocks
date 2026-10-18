/**
 * Neon District — rain on the glass.
 *
 * The district is seen through a pane of glass in the rain. On it:
 *
 *  - beads: drops of two sizes on a jittered grid. Each lands with a little splash, sits, and
 *    shrinks as it evaporates, then another lands somewhere else in its cell; the heaviest slip a
 *    short way down in a jerk or two;
 *  - runners: heavier drops running down the pane. A runner gathers out of nothing, swells while
 *    it is pinned, breaks loose, slides and stops short (each rest and each slip its own length),
 *    and wobbles as it stops; one run in five is a heavy drop that goes the whole way in one go.
 *    It is a teardrop — a full head, a tail up the way it came that stretches as it speeds up —
 *    and it wanders down a kinked path of its own each run. Behind it a thin film of water breaks
 *    up into beads of uneven size, a little off the line, fixed to the glass where they were left;
 *    where it rested it leaves a bigger one. It sweeps up the beads in its way;
 *  - mist: fine condensation over the rest of the pane, which the runners wipe clear and which
 *    grows back over their trails.
 *
 * Every drop is a small lens: through it the street is seen upside down and shrunk (the output
 * pass samples the scene at an offset AGAINST the drop's outward normal, scaled by its size), its
 * edge darkens where the light is turned away, and a glint of the neon behind it sits on its
 * shoulder. Everything is a function of screen position and time (and so of `seek`), drawn in
 * the post's one output pass: no particles, no extra geometry, no state.
 *
 * Coordinates: `p` is the screen in screen HEIGHTS (x × aspect, y down from the top), so drops
 * keep their size and shape at any aspect ratio. Gravity is +y. Times are seconds.
 *
 * Written for this theme (not adapted from another shader).
 */

import {
    Fn,
    abs,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    normalize,
    select,
    sign,
    sin,
    smoothstep,
    sqrt,
    step,
    vec2,
    vec4,
} from 'three/tsl';
import { ndHash11, ndHash21, ndHash22 } from './neon-district-tsl.js';

/** Rests (each followed by a slip) in a runner's stick-slip run down the pane. */
const SLOTS = 8;
/** Edge anti-aliasing half-width, in screen heights. */
const EDGE = 1.4 / 1080;

/** 1 inside a signed distance (screen heights), 0 outside, anti-aliased. */
const inside = (sd) => float(1.0).sub(smoothstep(-EDGE, EDGE, sd));

/**
 * Bead: one candidate drop per grid cell, landing again every few seconds.
 * Returns vec4(centre.x, centre.y, radius, age in seconds); radius 0 when the cell is empty.
 */
export const ndGlassBead = /* @__PURE__ */ Fn(([p, scale, density, time, seed]) => {
    const id = floor(p.mul(scale));
    const h0 = ndHash21(id.add(vec2(seed, seed.mul(0.61))));
    // A cell's drop lands, sits and evaporates over its own lifetime, then lands again elsewhere.
    const life = h0.mul(14.0).add(9.0);
    const cycle = time.div(life).add(h0.mul(17.0));
    const gen = floor(cycle);
    const age = fract(cycle);
    const ageSec = age.mul(life);
    const hj = ndHash22(id.add(vec2(gen.mul(7.13), gen.mul(3.71)).add(seed)));
    const present = step(float(1.0).sub(density), ndHash21(id.add(vec2(gen.mul(1.31), seed.mul(2.17)))));
    const size = ndHash21(id.add(vec2(seed.mul(0.37), gen.mul(5.3))));
    // It lands with a splash (spreads past its size and settles back), then dries away.
    const land = smoothstep(0.0, 0.1, ageSec)
        .mul(exp(ageSec.mul(-9.0)).mul(sin(ageSec.mul(34.0))).mul(0.12).add(1.0));
    const dry = float(1.0).sub(smoothstep(0.55, 1.0, age).mul(0.7));
    const rCell = size.mul(size).mul(0.3).add(0.07)
        .mul(land.mul(dry).mul(present));
    // The heaviest slip a little way down their cell in two jerks while they are fresh and full.
    const heavy = step(0.78, size);
    const slip = smoothstep(0.3, 0.34, age).add(smoothstep(0.61, 0.66, age)).mul(0.1);
    const centre = mix(hj.mul(0.56).add(0.22), vec2(hj.x.mul(0.16).add(0.42), slip.add(0.42)), heavy);
    return vec4(id.add(centre).div(scale), rCell.div(scale), ageSec);
}).setLayout({
    name: 'nd_glassBead',
    type: 'vec4',
    inputs: [
        { name: 'p', type: 'vec2' }, { name: 'scale', type: 'float' }, { name: 'density', type: 'float' },
        { name: 'time', type: 'float' }, { name: 'seed', type: 'float' },
    ],
});

/**
 * A runner's path across its column at height y: a slow wander and sharper kinks (where the
 * water was held up and turned), its own each run (`key`), never more than `amp` off centre.
 */
export const ndGlassPath = /* @__PURE__ */ Fn(([y, key, colX, amp]) => {
    const g1 = y.mul(4.6).add(key.mul(13.1));
    const i1 = floor(g1);
    const f1 = fract(g1);
    const k1 = key.mul(7.7);
    const f1s = f1.mul(f1).mul(float(3.0).sub(f1.mul(2.0)));
    const wander = mix(ndHash11(i1.add(k1)), ndHash11(i1.add(k1).add(1.0)), f1s);
    const g2 = y.mul(21.0).add(key.mul(5.3));
    const i2 = floor(g2);
    const f2 = fract(g2);
    const k2 = key.mul(3.1).add(19.0);
    // Mostly straight between knots, so the turns read as kinks.
    const f2s = mix(f2, f2.mul(f2).mul(float(3.0).sub(f2.mul(2.0))), 0.3);
    const kinks = mix(ndHash11(i2.add(k2)), ndHash11(i2.add(k2).add(1.0)), f2s);
    return colX.add(amp.mul(wander.mul(0.72).add(kinks.mul(0.28)).mul(2.0).sub(1.0)));
}).setLayout({
    name: 'nd_glassPath',
    type: 'float',
    inputs: [
        { name: 'y', type: 'float' }, { name: 'key', type: 'float' }, { name: 'colX', type: 'float' },
        { name: 'amp', type: 'float' },
    ],
});

/**
 * A column's runner at a moment. Each run (16-30 s) has its own size, start, path and kind:
 *
 *  - stick-slip (four runs in five): it gathers at its start and swells, then slips from rest to
 *    rest — SLOTS rests at jittered heights, so every slip is its own length; within each slot it
 *    breaks loose at its own moment, eases into the slide and stops short — and from the last
 *    rest, near the foot of the pane, it slips out of the frame;
 *  - heavy (one in five): it gathers, then runs the whole way, gaining speed.
 *
 * After it leaves the frame its trail fades for the rest of the run.
 * Built inline inside each caller's Fn (it returns several values).
 */
const runnerState = (col, cols, time, seed) => {
    const colW = float(1.0).div(cols);
    const colX = col.sub(seed).add(0.5).mul(colW);
    const h = ndHash21(vec2(col, seed.mul(1.7).add(3.0)));
    const period = h.mul(14.0).add(16.0);
    const runs = time.div(period).add(h.mul(11.0));
    const run = floor(runs);
    const u = fract(runs);
    const ra = ndHash22(vec2(col.mul(1.37).add(run.mul(7.31)), seed.mul(5.1).add(run.mul(1.93))));
    const rb = ndHash22(vec2(run.mul(3.71).add(seed), col.mul(2.33).add(11.0)));
    const key = ra.x;
    const live = step(0.28, ra.y);
    const heavy = step(0.8, fract(key.mul(13.7)));
    const rBase = rb.x.mul(rb.x).mul(0.013).add(0.011).mul(mix(1.0, 1.2, heavy));
    // Room to wander inside the column (the head never crosses into the next one).
    const amp = max(colW.mul(0.5).sub(rBase.mul(1.35)), 0.0);
    const y0 = rb.y.mul(0.5).sub(0.1);

    // ── stick-slip ──
    const yLast = fract(key.mul(5.3)).mul(0.07).add(0.88);
    const span = yLast.sub(y0);
    /** Where the drop rests before slip j (0 = where it gathered, SLOTS − 1 = the last rest). */
    const restAt = (j) => {
        const jitter = ndHash21(vec2(j, key.mul(31.7).add(1.3))).sub(0.5).mul(0.8);
        const inner = step(0.5, j).mul(step(j, SLOTS - 1.5));
        return y0.add(span.mul(j.add(jitter.mul(inner))).div(SLOTS - 1));
    };
    const slotT = u.mul(SLOTS);
    const slot = floor(slotT);
    const l = fract(slotT);
    const slotSec = period.div(SLOTS);
    const isFirst = step(slot, 0.5);
    const isLast = step(SLOTS - 1.5, slot);
    const from = restAt(slot);
    const to = select(slot.greaterThan(SLOTS - 1.5), float(1.25), restAt(slot.add(1.0)));
    const hs = ndHash22(vec2(slot.add(key.mul(17.0)), key.mul(3.3).add(7.0)));
    const stepLen = to.sub(from);
    // Heavier drops slide faster; a slip lasts a fifth of a second to under half its slot.
    const vSlide = hs.x.mul(0.16).add(0.12).mul(sqrt(rBase.div(0.018)));
    const slideSec = clamp(stepLen.div(vSlide), 0.22, slotSec.mul(0.42));
    const slideFrac = slideSec.div(slotSec);
    // When it breaks loose: its own moment each slot, late in the first (it is still gathering),
    // early in the last (so the trail has time to fade before the next run).
    const lo = mix(0.22, 0.5, isFirst);
    const start = mix(mix(lo, max(lo, float(0.78).sub(slideFrac)), hs.y), 0.12, isLast);
    const x = clamp(l.sub(start).div(slideFrac), 0.0, 1.0);
    const ease = x.mul(x).mul(float(3.0).sub(x.mul(2.0)));
    const yS = mix(from, to, ease);
    const vS = stepLen.mul(x.mul(float(1.0).sub(x)).mul(6.0)).div(slideSec);
    const sinceSlip = l.sub(start.add(slideFrac)).mul(slotSec);
    // Seconds since it last stopped (negative while sliding); before this slot's slip, the last
    // one ended at least a fifth of a slot ago.
    const sinceS = mix(sinceSlip, l.add(0.22).mul(slotSec), step(l, start));
    const swellS = mix(0.25, 1.0, smoothstep(0.0, start, l)).mul(float(1.0).sub(ease.mul(0.75)));
    const birthS = mix(1.0, smoothstep(0.0, start.mul(0.85), l), isFirst);
    const afterLast = float(1.0).sub(start).sub(slideFrac).mul(slotSec);
    const fadeS = float(1.0).sub(isLast.mul(smoothstep(0.0, afterLast, sinceSlip)));

    // ── heavy: one run, gaining speed ──
    const uGo = fract(key.mul(23.1)).mul(0.2).add(0.22);
    const vRun = fract(key.mul(9.1)).mul(0.25).add(0.3);
    const travel = float(1.25).sub(y0);
    const runSec = travel.div(vRun);
    const xe = clamp(u.sub(uGo).mul(period).div(runSec), 0.0, 1.0);
    const yE = y0.add(travel.mul(xe.mul(xe).mul(float(2.0).sub(xe))));
    const vE = travel.mul(xe.mul(4.0).sub(xe.mul(xe).mul(3.0))).div(runSec).mul(step(xe, 0.999));
    const sinceRun = u.sub(uGo).mul(period).sub(runSec);
    const sinceE = select(u.lessThan(uGo), float(10.0), sinceRun);
    const fadeE = float(1.0).sub(smoothstep(0.0, float(1.0).sub(uGo).mul(period).sub(runSec), sinceRun));

    const swell = mix(swellS, smoothstep(0.0, uGo, u), heavy);
    const birth = mix(birthS, smoothstep(0.0, uGo.mul(0.85), u), heavy);
    return {
        colX,
        amp,
        key,
        live,
        heavy,
        rBase,
        y0,
        restAt,
        span,
        headY: mix(yS, yE, heavy),
        /** The head's radius now: swollen while pinned, thinner after a slip, grown from nothing. */
        r: rBase.mul(mix(swell.mul(0.25).add(0.85), swell.mul(0.15).add(0.9), heavy)).mul(birth),
        speed: mix(vS, vE, heavy),
        since: mix(sinceS, sinceE, heavy),
        /** Where the current slip began: the film of water left behind starts here. */
        slideFrom: mix(from, y0, heavy),
        fade: mix(fadeS, fadeE, heavy).mul(live),
        /** Mean speed down the pane, to tell roughly when the head passed a height. */
        meanSpeed: mix(float(1.25).sub(y0).div(period.mul(0.85)), vRun, heavy),
    };
};

/**
 * A teardrop in its own frame: the head circle (radius r1) at the origin, the tail circle (r2)
 * at (0, h) up the tail, joined by the lines tangent to both. `lp` = (|across|, along the tail).
 * Returns the signed distance, the radius of the inscribed circle there (to scale the lens) and
 * the outward normal.
 */
const teardrop = (lp, r1, r2, h) => {
    const b = r1.sub(r2).div(h);
    const a = sqrt(max(float(1.0).sub(b.mul(b)), 0.0));
    const k = dot(lp, vec2(b.negate(), a));
    const onHead = k.lessThan(0.0);
    const onTail = k.greaterThan(a.mul(h));
    const toTail = lp.sub(vec2(0.0, h));
    const sd = select(onHead, length(lp).sub(r1), select(onTail, length(toTail).sub(r2), dot(lp, vec2(a, b)).sub(r1)));
    const rl = select(onHead, r1, select(onTail, r2, mix(r1, r2, clamp(k.div(a.mul(h)), 0.0, 1.0))));
    const n = select(
        onHead,
        lp.div(max(length(lp), 1e-6)),
        select(onTail, toTail.div(max(length(toTail), 1e-6)), vec2(a, b)),
    );
    return { sd, rl, n };
};

/** The nearer of two drops (vec4(q·cover, cover, r) each): the more covering one wins. */
const nearer = (a, b) => mix(a, b, step(a.z, b.z));

/**
 * Runners: one per column, with its film, its trail beads and the beads it left where it rested.
 * Returns vec4(q·cover, cover, r) for the drop that covers p most.
 */
export const ndGlassRunners = /* @__PURE__ */ Fn(([p, cols, time, seed]) => {
    const col = floor(p.x.mul(cols).add(seed));
    const R = runnerState(col, cols, time, seed);
    const pathAt = (y) => ndGlassPath(y, R.key, R.colX, R.amp);

    // ── the head: a teardrop, its tail up the way it came and longer the faster it goes ──
    const r = max(R.r, 1e-4);
    const hx = pathAt(R.headY);
    const sp = clamp(R.speed.div(0.3), 0.0, 1.0);
    const tailLen = r.mul(mix(0.42, 2.7, sp));
    const rTail = r.mul(mix(0.74, 0.24, sp));
    const up = normalize(vec2(pathAt(R.headY.sub(tailLen)).sub(hx), tailLen.negate()));
    const across = vec2(up.y.negate(), up.x);
    // It wobbles as it stops short: squashes and stretches, dying away in half a second.
    const tStop = max(R.since, 0.0);
    const wob = exp(tStop.mul(-7.5)).mul(sin(tStop.mul(40.0))).mul(0.14)
        .mul(step(0.0, R.since));
    const d = p.sub(vec2(hx, R.headY));
    const lx = dot(d, across).mul(float(1.0).add(wob));
    const ly = dot(d, up).mul(float(1.0).sub(wob));
    const tear = teardrop(vec2(abs(lx), ly), r, rTail, tailLen);
    const qHead = across.mul(tear.n.x.mul(sign(lx))).add(up.mul(tear.n.y))
        .mul(max(float(1.0).add(tear.sd.div(tear.rl)), 0.0));
    const coverHead = inside(tear.sd).mul(step(0.0006, R.r)).mul(R.live);
    const head = vec4(qHead.mul(coverHead), coverHead, tear.rl);

    // Trail-bead sites: one candidate per cell down the path, fixed to the glass.
    const cell = R.rBase.mul(2.0);
    const kb = floor(p.y.div(cell));
    const hb = ndHash22(vec2(kb, R.key.mul(41.0).add(col.mul(0.37))));
    const hc = ndHash21(vec2(kb.mul(1.71), R.key.mul(17.3).add(5.0)));
    const by = kb.add(hb.y.mul(0.4).add(0.3)).mul(cell);

    // ── the film: a thin streak of water behind a slip, breaking up within half a second (or,
    //    behind a heavy runner, a few drop-lengths back). Away from the head it necks between
    //    the bead sites and swells at them, so it breaks into the beads ──
    const filmAt = (y) => float(1.0).sub(smoothstep(0.0, 0.6, R.since))
        .mul(float(1.0).sub(smoothstep(0.25, 0.5, R.headY.sub(y))))
        .mul(step(R.slideFrom, y));
    const filmEnd = R.headY.sub(tailLen.mul(0.6));
    const neck = smoothstep(0.02, 0.16, R.headY.sub(p.y));
    const bulge = float(1.0).sub(smoothstep(0.0, cell.mul(0.5), abs(p.y.sub(by))));
    const wFilm = R.rBase.mul(0.17).mul(mix(0.5, 1.0, smoothstep(R.slideFrom, filmEnd, p.y)))
        .mul(mix(float(1.0), mix(0.2, 1.3, bulge), neck))
        .mul(filmAt(p.y))
        .mul(step(p.y, filmEnd));
    const dxFilm = p.x.sub(pathAt(p.y));
    const coverFilm = inside(abs(dxFilm).sub(wFilm)).mul(step(1e-4, wFilm)).mul(R.live);
    const film = vec4(vec2(dxFilm.div(max(wFilm, 1e-5)), 0.0).mul(coverFilm), coverFilm, wFilm);

    // ── trail beads: what the film broke into, where it was left, of uneven size and a little
    //    off the line, drying as the drop goes on ──
    const bx = pathAt(by).add(hc.sub(0.5).mul(R.rBase).mul(0.9));
    const rBead = R.rBase.mul(hb.x.mul(hb.x).mul(0.34).add(0.2))
        .mul(step(0.22, fract(hb.x.mul(7.9))))
        .mul(mix(0.6, 1.0, exp(R.headY.sub(by).mul(-0.9))))
        .mul(float(1.0).sub(filmAt(by).mul(0.85)))
        .mul(R.fade)
        .mul(step(R.y0.add(R.rBase), by))
        .mul(step(by, R.headY.sub(r.mul(0.5))));
    const db = p.sub(vec2(bx, by));
    const coverBead = inside(length(db).sub(rBead)).mul(step(1e-4, rBead));
    const bead = vec4(db.div(max(rBead, 1e-5)).mul(coverBead), coverBead, rBead);

    // ── where it rested it left a bigger bead behind (stick-slip runs) ──
    const j = clamp(floor(p.y.sub(R.y0).mul(SLOTS - 1).div(max(R.span, 0.05)).add(0.5)), 1.0, SLOTS - 1);
    const yRest = R.restAt(j);
    const hr = ndHash21(vec2(j.add(R.key.mul(53.0)), 2.7));
    const cRest = vec2(pathAt(yRest).add(hr.sub(0.5).mul(R.rBase).mul(0.5)), yRest.sub(R.rBase.mul(0.55)));
    const rRest = R.rBase.mul(hr.mul(0.18).add(0.24))
        .mul(step(0.35, fract(hr.mul(5.3))))
        .mul(step(yRest.add(r.mul(0.6)), R.headY))
        .mul(exp(R.headY.sub(cRest.y).mul(-0.6)))
        .mul(float(1.0).sub(R.heavy))
        .mul(R.fade);
    const dr = p.sub(cRest);
    const coverRest = inside(length(dr).sub(rRest)).mul(step(1e-4, rRest));
    const rest = vec4(dr.div(max(rRest, 1e-5)).mul(coverRest), coverRest, rRest);

    return nearer(nearer(nearer(bead, rest), film), head);
}).setLayout({
    name: 'nd_glassRunners',
    type: 'vec4',
    inputs: [
        { name: 'p', type: 'vec2' }, { name: 'cols', type: 'float' }, { name: 'time', type: 'float' },
        { name: 'seed', type: 'float' },
    ],
});

/** How clear of mist a runner has wiped the glass at p (1 just behind the head, fading back in). */
export const ndGlassWipe = /* @__PURE__ */ Fn(([p, cols, time, seed]) => {
    const col = floor(p.x.mul(cols).add(seed));
    const R = runnerState(col, cols, time, seed);
    const across = abs(p.x.sub(ndGlassPath(p.y, R.key, R.colX, R.amp))).div(R.rBase);
    const behind = R.headY.sub(p.y);
    // The mist grows back over the trail in a few seconds' worth of distance, and the whole trail
    // fades once its drop has left the frame.
    return float(1.0).sub(smoothstep(0.55, 1.0, across))
        .mul(step(R.y0.sub(R.rBase), p.y)).mul(step(0.0, behind))
        .mul(exp(behind.mul(-2.0)))
        .mul(R.fade);
}).setLayout({
    name: 'nd_glassWipe',
    type: 'float',
    inputs: [
        { name: 'p', type: 'vec2' }, { name: 'cols', type: 'float' }, { name: 'time', type: 'float' },
        { name: 'seed', type: 'float' },
    ],
});

/**
 * How far a runner has swept up a bead (vec4 from ndGlassBead): 1 if the head has come down over
 * it since it landed, easing back to 0 as that trail dries (new rain lands on it).
 */
export const ndGlassSwept = /* @__PURE__ */ Fn(([bead, cols, time, seed]) => {
    const c = bead.xy;
    const col = floor(c.x.mul(cols).add(seed));
    const R = runnerState(col, cols, time, seed);
    const across = abs(c.x.sub(ndGlassPath(c.y, R.key, R.colX, R.amp)));
    const behind = R.headY.sub(c.y);
    return step(across, R.rBase.add(bead.z.mul(0.5)))
        .mul(step(R.r.mul(-0.6), behind))
        .mul(step(R.y0.sub(R.rBase), c.y))
        .mul(step(behind.div(R.meanSpeed), bead.w))
        .mul(R.fade);
}).setLayout({
    name: 'nd_glassSwept',
    type: 'float',
    inputs: [
        { name: 'bead', type: 'vec4' }, { name: 'cols', type: 'float' }, { name: 'time', type: 'float' },
        { name: 'seed', type: 'float' },
    ],
});

/** Fine condensation: value noise, more of it toward the foot and the edges of the pane. */
export const ndGlassMist = /* @__PURE__ */ Fn(([p, st]) => {
    const g = p.mul(9.0);
    const i = floor(g);
    const f = fract(g);
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const a = ndHash21(i);
    const b = ndHash21(i.add(vec2(1.0, 0.0)));
    const c = ndHash21(i.add(vec2(0.0, 1.0)));
    const d = ndHash21(i.add(vec2(1.0, 1.0)));
    const n = mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    const edge = max(smoothstep(0.55, 1.0, st.y), smoothstep(0.35, 0.5, abs(st.x.sub(0.5))));
    return clamp(n.mul(0.6).add(0.4).mul(edge.mul(0.5).add(0.5)), 0.0, 1.0);
}).setLayout({
    name: 'nd_glassMist',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'st', type: 'vec2' }],
});

/** Runner layers [columns per screen height, column offset]; bead layers [cells, density, seed]. */
const RUNNER_LAYERS = [[13, 0.0], [9, 0.37]];
const BEAD_LAYERS = [[26, 0.42, 1.0], [58, 0.5, 7.0]];

/**
 * The pane at a screen point: its lens offset (UV), how much drop covers it, how much mist, and
 * the drop's disc position for shading. `layers` = 1 (one bead and one runner layer) or 2.
 * @returns {{ offset: object, cover: object, mist: object, q: object, z: object }}
 */
export function ndGlass(st, aspect, time, layers) {
    const p = vec2(st.x.mul(aspect), st.y);
    const runners = RUNNER_LAYERS.slice(0, layers);
    const elements = [];
    // Beads, less those a runner has swept up (they shrink back in as its trail dries).
    BEAD_LAYERS.slice(0, layers).forEach(([scale, density, seed]) => {
        const b = ndGlassBead(p, float(scale), float(density), time, float(seed));
        let swept = float(0.0);
        runners.forEach(([cols, offset]) => {
            swept = max(swept, ndGlassSwept(b, float(cols), time, float(offset)));
        });
        const rb = b.z.mul(float(1.0).sub(swept));
        const d = p.sub(b.xy);
        const cover = inside(length(d).sub(rb)).mul(step(1e-4, rb));
        elements.push(vec4(d.div(max(rb, 1e-5)).mul(cover), cover, rb));
    });
    let wipe = float(0.0);
    runners.forEach(([cols, offset]) => {
        elements.push(ndGlassRunners(p, float(cols), time, float(offset)));
        wipe = max(wipe, ndGlassWipe(p, float(cols), time, float(offset)));
    });
    // Combine: the most covering drop decides the shading; the lens offsets add (the strength is
    // ~5 drop radii at the rim: through a drop the street is seen inverted and shrunk).
    let lens = vec2(0.0);
    let cover = float(0.0);
    let q = vec2(0.0);
    elements.forEach((e) => {
        lens = lens.add(e.xy.mul(e.w).mul(5.0));
        q = mix(q, e.xy.div(max(e.z, 1e-3)), step(cover, e.z));
        cover = max(cover, e.z);
    });
    const r2 = min(dot(q, q), 1.0);
    // Drops gather the mist round them as they land: the glass is clearer near a drop.
    const mist = ndGlassMist(p, st).mul(float(1.0).sub(wipe)).mul(float(1.0).sub(cover));
    return {
        offset: vec2(lens.x.div(aspect), lens.y).negate(),
        cover,
        mist,
        q,
        z: sqrt(float(1.0).sub(r2)),
    };
}

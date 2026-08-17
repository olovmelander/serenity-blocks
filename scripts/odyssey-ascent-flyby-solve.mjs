/**
 * WAVE 1C — THE MASSIF FLYBY SOLVER.
 *
 * Owner (2026-08-16, after playing Wave 1A): "route the ascending path much closer to
 * the mountainside, bypassing the peak in close proximity" — while KEEPING the cloud
 * transition.
 *
 * WHY A GENERATOR AND NOT HAND-NUDGING. Wave 1A's own header records the law: Catmull-Rom
 * curvature depends on SPACING as much as direction, so a point moved by hand spikes the
 * turn rate somewhere else. This regenerates the whole ascent from a design — anchors the
 * curve must pass through — and RESAMPLES it at even arc spacing, which is what keeps the
 * curvature bounded. Iterate the anchors, never the emitted points.
 *
 * WHAT IS FIXED (and must stay bit-for-bit):
 *   - everything up to and including cp15 (-210, 622, -572): Act II's authored approach;
 *   - cp22 (160.8, 1205.5, -719.5), the corridor join, and every corridor point after it —
 *     the space run was rigidly translated by Wave 1A and must not move again.
 * Only cp16..cp21 are regenerated (and the count may change).
 *
 * Usage:  node scripts/odyssey-ascent-flyby-solve.mjs [--emit]
 */
/* eslint-disable no-console */
import * as THREE from 'three';
import { ODYSSEY_LAYOUT_DATA } from '../src/core/odyssey/data/odyssey-layout.js';
import { ODYSSEY_MASSIFS, odysseyWorldHeight } from '../src/rendering/odyssey/world/odyssey-world-height.js';

const CURVE_TYPE = 'catmullrom';
const TENSION = 0.3;
const ARC_STEP_UNITS = 5.30; // the corridor guard's own step
const HERO = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
const BASE_LENGTH = 2393.89; // Wave 1A's pinned total, the arc the re-map is relative to

const BASE = ODYSSEY_LAYOUT_DATA.controlPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
const PRE = BASE.slice(0, 16); // 0..15 — untouched
// ⚠️ KEEP THE LAST TWO ASCENT POINTS. Catmull-Rom is local but not pointwise: the segment
// cp21→cp22 depends on cp20..cp23, and cp22→cp23 on cp21..cp24. A first attempt regenerated
// through cp21 and, although the join POINT was preserved, the arrival DIRECTION changed and
// bent the corridor's own first segments — the ch6 turn guard read 17.2 deg against a 4.11
// baseline for a corridor nobody had touched. Freezing cp20 and cp21 makes everything from
// cp21 onward bit-for-bit the shipped curve, so the flyby must live inside cp15..cp20.
const TAIL = [BASE[20].clone(), BASE[21].clone()];
const JOIN = BASE[22].clone();
const POST = BASE.slice(23);

/** Arc fraction (the `getPointAt` domain) at which a curve passes closest to a point. */
function arcFractionOf(curve, target, samples = 4000) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i <= samples; i += 1) {
        const u = i / samples;
        const d = curve.getPointAt(u).distanceToSquared(target);
        if (d < bestD) { bestD = d; best = u; }
    }
    return best;
}

function buildCurve(points) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => p.clone()));
    curve.curveType = CURVE_TYPE;
    curve.tension = TENSION;
    return curve;
}

/**
 * Anchor design → evenly spaced control points.
 * The ascent is described by where it must GO; spacing is then imposed by resampling.
 */
function generateAscent({ flyby, flybyY, approachBias, count }) {
    const prev = BASE[14].clone(); // tangent context so the curve leaves cp15 as it does today
    const start = BASE[15].clone();
    const end = TAIL[0].clone(); // cp20, frozen
    const endNext = TAIL[1].clone(); // cp21, frozen
    const toFly = new THREE.Vector3(flyby.x, flybyY, flyby.z);
    // One handle on each side of the flyby so the S does not corner at the waypoint.
    const approach = new THREE.Vector3(
        start.x + (toFly.x - start.x) * approachBias,
        start.y + (toFly.y - start.y) * 0.62,
        start.z + (toFly.z - start.z) * approachBias,
    );
    const exit = new THREE.Vector3(
        toFly.x + (end.x - toFly.x) * 0.5,
        toFly.y + (end.y - toFly.y) * 0.45,
        toFly.z + (end.z - toFly.z) * 0.5,
    );
    // 7 anchors: cp14, cp15, approach, flyby, exit, cp20, cp21.
    // ⚠️ ARC FRACTION, NOT PARAMETER. Anchor i sits at PARAMETER i/(n-1), but `getPointAt`
    // takes an ARC fraction — the two are different on an unevenly spaced anchor set. Using
    // 1/6 and 5/6 as arc fractions resampled the wrong sub-range and left a 167 u gap into
    // the frozen tail against 81 u elsewhere, which is precisely the spacing spike Wave 1A's
    // header warns about. Locate the endpoints by arc instead.
    const shaping = buildCurve([prev, start, approach, toFly, exit, end, endNext]);
    const t0 = arcFractionOf(shaping, start);
    const t1 = arcFractionOf(shaping, end);
    const pts = [];
    for (let i = 1; i <= count; i += 1) {
        pts.push(shaping.getPointAt(t0 + ((t1 - t0) * i) / (count + 1)));
    }
    return pts;
}

function measure(ascentPoints) {
    const points = [...PRE, ...ascentPoints, ...TAIL, JOIN, ...POST];
    const curve = buildCurve(points);
    const length = curve.getLength();

    // --- flyby proximity: closest approach of the RAIL to the massif AXIS in XZ ---
    let minAxis = Infinity;
    let minAxisY = 0;
    let minAxisP = 0;
    // --- terrain clearance ---
    // ⚠️ ONLY over the ascent region. Chapter 1 is a vertical shaft that legitimately runs
    // BELOW the height field (the cavern sits under the ocean floor), so a whole-curve
    // minimum reports −132 for every candidate including the untouched baseline and says
    // nothing about the flyby.
    let minClear = Infinity;
    let minClearP = 0;
    const N = 3000;
    for (let i = 0; i <= N; i += 1) {
        const t = i / N;
        const p = curve.getPointAt(t);
        const axis = Math.hypot(p.x - HERO.x, p.z - HERO.z);
        if (axis < minAxis) { minAxis = axis; minAxisY = p.y; minAxisP = t; }
        if (t >= 0.20) {
            const ground = odysseyWorldHeight(p.x, p.z);
            const clear = p.y - ground;
            if (clear < minClear) { minClear = clear; minClearP = t; }
        }
    }

    // --- the corridor guard, replicated exactly (measured over chapter 6) ---
    // ⚠️ MEASURE THE POST-REMAP WINDOW. `p` is arc-normalised over the whole curve, so
    // lengthening the ascent moves what p=0.7401 POINTS AT — scoring the old p values on a
    // longer curve measures part of the ascent's arc-over and reads ~15 deg for geometry
    // that has not changed. Chapters 6-8 are arc-preserving under the re-map (all the added
    // length is before the boundary), so their new p is (old_arc + added) / newLength.
    const step = ARC_STEP_UNITS / length;
    const added = length - BASE_LENGTH;
    const ch6Start = (0.7401 * BASE_LENGTH + added) / length;
    const ch6End = (0.8634 * BASE_LENGTH + added) / length;
    let previous = null;
    let maxTurn = 0;
    let totalTurn = 0;
    let minTangentY = Infinity;
    for (let t = ch6Start; t <= ch6End + 1e-9; t += step) {
        const tangent = curve.getTangentAt(Math.min(t, 1)).normalize();
        minTangentY = Math.min(minTangentY, tangent.y);
        if (previous) {
            const turn = THREE.MathUtils.radToDeg(tangent.angleTo(previous));
            maxTurn = Math.max(maxTurn, turn);
            totalTurn += turn;
        }
        previous = tangent;
    }

    // --- CLIMB smoothness, over a PHYSICALLY defined window (rail y 620→1200) so the
    // baseline and every candidate are measured over the same real stretch of world
    // regardless of how long the curve got. This is the flyby's own bank rate.
    let ascentMaxTurn = 0;
    let ascentTotalTurn = 0;
    previous = null;
    for (let t = 0; t <= 1; t += step) {
        const p = curve.getPointAt(t);
        if (p.y < 620 || p.y > 1200) { previous = null; continue; }
        const tangent = curve.getTangentAt(t).normalize();
        if (previous) {
            const turn = THREE.MathUtils.radToDeg(tangent.angleTo(previous));
            ascentMaxTurn = Math.max(ascentMaxTurn, turn);
            ascentTotalTurn += turn;
        }
        previous = tangent;
    }

    let apex = -Infinity;
    for (let i = 0; i <= 1000; i += 1) apex = Math.max(apex, curve.getPointAt(i / 1000).y);

    return {
        length,
        minAxis,
        minAxisY,
        minAxisP,
        rockClearAtFlyby: minAxis - rockRadiusAt(minAxisY),
        minClear,
        minClearP,
        maxTurn,
        totalTurn,
        minTangentY,
        ascentMaxTurn,
        ascentTotalTurn,
        apex,
        points,
        ascentPoints,
    };
}

/** Horizontal distance from the massif axis to its rock surface at height y. */
function rockRadiusAt(y) {
    const above = y - HERO.footY;
    if (above <= 0) return HERO.radius;
    if (above >= HERO.height) return 0;
    const cone = (above / HERO.height) ** (1 / HERO.exponent);
    return Math.max(0, HERO.radius * (1 - cone));
}

// The shipped curve, measured with the same instrument — every candidate is judged
// against THIS, not against an absolute ideal.
const BASELINE = measure(BASE.slice(16, 20)); // the shipped ascent, same instrument
console.log(
    `BASELINE  axis ${BASELINE.minAxis.toFixed(0)} (y ${BASELINE.minAxisY.toFixed(0)})`
    + ` rockClr ${BASELINE.rockClearAtFlyby.toFixed(0)} minClr ${BASELINE.minClear.toFixed(0)}`
    + ` | ch6 maxTurn ${BASELINE.maxTurn.toFixed(2)} total ${BASELINE.totalTurn.toFixed(1)}`
    + ` | CLIMB maxTurn ${BASELINE.ascentMaxTurn.toFixed(2)} total ${BASELINE.ascentTotalTurn.toFixed(1)}`
    + ` | length ${BASELINE.length.toFixed(1)}\n`,
);

const CANDIDATES = [];
// Design sweep: how close to hug, at what height, and how much the exit is lifted.
for (const dist of [150, 170, 190, 210, 240, 280]) {
    for (const bearing of [0.15, 0.30, 0.45, 0.60]) { // 0 = due south of the peak
        for (const flybyY of [900, 950, 1000, 1050]) {
            for (const count of [5, 6, 7, 8]) {
                for (const approachBias of [0.4, 0.55]) {
                    const dir = new THREE.Vector3(bearing, 0, Math.sqrt(1 - bearing * bearing));
                    const flyby = { x: HERO.x + dir.x * dist, z: HERO.z + dir.z * dist };
                    const ascent = generateAscent({
                        flyby, flybyY, approachBias, count,
                    });
                    const m = measure(ascent);
                    CANDIDATES.push({
                        dist, bearing, flybyY, count, approachBias, ...m,
                    });
                }
            }
        }
    }
}

// Gates are the SHIPPED TEST LIMITS, plus "no worse than the baseline" where the baseline
// is itself the reference: the shipped curve measures minClear 46.3 over the ascent region
// (a >60 gate rejected the untouched path), maxTurn 4.11, totalTurn 27.7, tangentY 0.311.
// CLIMB_TURN_LIMIT is the real design constraint. The shipped climb banks at 3.47 deg per
// 5.30 u; the flyby is allowed to bank harder (it is a flyby) but not to lurch. 6.0 is
// ~1.7x the baseline and still under the corridor guard's own 5.2-per-step sensibility
// applied to a stretch the guard does not police.
const CLIMB_TURN_LIMIT = Number(process.env.CLIMB_TURN_LIMIT || 6.0);
const ok = CANDIDATES.filter((c) => (
    c.maxTurn < 5.2 && c.totalTurn < 45 && c.minTangentY > 0.1
    && c.minClear > 40 && c.rockClearAtFlyby > 80
    && c.ascentMaxTurn < CLIMB_TURN_LIMIT
));
ok.sort((a, b) => a.minAxis - b.minAxis);

console.log(`candidates: ${CANDIDATES.length}, passing gates: ${ok.length}`);

// WHY they fail — count each gate's rejections, and show the closest misses. Without this
// the sweep just says "no" and the next move is guesswork.
const fails = { maxTurn: 0, totalTurn: 0, tangentY: 0, groundClear: 0, rockClear: 0 };
CANDIDATES.forEach((c) => {
    if (!(c.maxTurn < 5.2)) fails.maxTurn += 1;
    if (!(c.totalTurn < 45)) fails.totalTurn += 1;
    if (!(c.minTangentY > 0.1)) fails.tangentY += 1;
    if (!(c.minClear > 60)) fails.groundClear += 1;
    if (!(c.rockClearAtFlyby > 80)) fails.rockClear += 1;
});
console.log('rejections by gate:', JSON.stringify(fails));
const byTurn = [...CANDIDATES].sort((a, b) => a.maxTurn - b.maxTurn).slice(0, 6);
console.log('\nBEST BY maxTurn (the corridor guard):');
console.log('dist bear  flyY cnt |  axis  rockClr  minClr | maxTurn totTurn tanY | ascTurn |  length   apex');
byTurn.forEach((c) => {
    console.log(
        `${String(c.dist).padStart(4)} ${c.bearing.toFixed(2)} ${String(c.flybyY).padStart(5)} ${String(c.count).padStart(3)} |`
        + ` ${c.minAxis.toFixed(0).padStart(5)} ${c.rockClearAtFlyby.toFixed(0).padStart(7)} ${c.minClear.toFixed(0).padStart(7)} |`
        + ` ${c.maxTurn.toFixed(2).padStart(7)} ${c.totalTurn.toFixed(1).padStart(7)} ${c.minTangentY.toFixed(2).padStart(4)} |`
        + ` ${c.ascentMaxTurn.toFixed(2).padStart(7)} |`
        + ` ${c.length.toFixed(1).padStart(7)} ${c.apex.toFixed(0).padStart(6)}`,
    );
});

const row = (c) => (
    `${String(c.dist).padStart(4)} ${c.bearing.toFixed(2)} ${String(c.flybyY).padStart(5)} ${String(c.count).padStart(3)} |`
    + ` ${c.minAxis.toFixed(0).padStart(5)} ${c.rockClearAtFlyby.toFixed(0).padStart(7)} ${c.minClear.toFixed(0).padStart(7)} |`
    + ` ${c.maxTurn.toFixed(2).padStart(7)} ${c.totalTurn.toFixed(1).padStart(7)} ${c.minTangentY.toFixed(2).padStart(4)} |`
    + ` ${c.ascentMaxTurn.toFixed(2).padStart(7)} |`
    + ` ${c.length.toFixed(1).padStart(7)} ${c.apex.toFixed(0).padStart(6)}`
);
// THE FRONTIER — the decision-quality output. How close can the rail get for a given
// tolerance on the climb's bank rate? (Baseline climb bank: 3.47 deg per 5.30 u.)
console.log('\nFRONTIER  bank limit -> closest achievable approach (all other gates passing)');
[4, 5, 6, 8, 10, 12, 15, 20, 30, 999].forEach((lim) => {
    const pass = CANDIDATES.filter((c) => (
        c.maxTurn < 5.2 && c.totalTurn < 45 && c.minTangentY > 0.1
        && c.minClear > 40 && c.rockClearAtFlyby > 80 && c.ascentMaxTurn < lim
    ));
    if (!pass.length) { console.log(`  bank < ${String(lim).padStart(3)} :  (none)`); return; }
    const best = pass.reduce((a, b) => (a.minAxis <= b.minAxis ? a : b));
    console.log(
        `  bank < ${String(lim).padStart(3)} :  axis ${best.minAxis.toFixed(0).padStart(4)} u`
        + ` (rock ${best.rockClearAtFlyby.toFixed(0).padStart(4)} u, bank ${best.ascentMaxTurn.toFixed(1).padStart(5)},`
        + ` len ${best.length.toFixed(0)})`,
    );
});

console.log(`\nCLOSEST APPROACH passing climb-turn < ${CLIMB_TURN_LIMIT}:`);
console.log('dist bear  flyY cnt |  axis  rockClr  minClr | maxTurn totTurn tanY | ascTurn |  length   apex');
ok.slice(0, 12).forEach((c) => console.log(row(c)));

if (process.argv.includes('--emit') && ok.length) {
    const best = ok[0];
    console.log('\n// EMITTED ASCENT (cp16..cp' + (15 + best.ascentPoints.length) + ')');
    best.ascentPoints.forEach((p) => {
        console.log(`    Object.freeze({ x: ${p.x.toFixed(1)}, y: ${p.y.toFixed(1)}, z: ${p.z.toFixed(1)} }),`);
    });
    console.log(`// length ${best.length.toFixed(2)} | axis ${best.minAxis.toFixed(1)} at y ${best.minAxisY.toFixed(0)} | rock clearance ${best.rockClearAtFlyby.toFixed(1)}`);
}

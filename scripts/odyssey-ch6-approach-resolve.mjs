/**
 * RE-SOLVE THE CH6 HERO `APPROACH` FITS against the current spline.
 *
 * The hero triad's A/B endpoints are least-squares solutions against a REPLAY of the real
 * camera, so any spline edit invalidates them — the Wave 1C flyby changed the climb's
 * approach direction and pushed the gas giant to ndcX −0.02 at entry (needs > 0) and the
 * summit earth to ndcY 0.96 (needs < 0.9).
 *
 * This searches offsets to planetA/planetB that satisfy every constraint the shipped tests
 * assert, while PRESERVING each hero's distance from the camera (so apparent size, and the
 * tuned scale ramps, are unchanged — the same rule the original solve used).
 */
/* eslint-disable no-console */
import * as THREE from 'three';
import {
    OdysseyCameraController,
    resolveChapterFramingForProgress,
} from '../src/rendering/odyssey/OdysseyCameraController.js';
import { getLevelRegistry } from '../src/core/odyssey/LevelRegistry.js';
import { getChapterPathRange, getOdysseyPathCurve } from '../src/rendering/odyssey/path-utils.js';
import {
    ODYSSEY_ACTS,
    ODYSSEY_CAMERA_PROFILES,
} from '../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';

const BEYOND = ODYSSEY_CAMERA_PROFILES[ODYSSEY_ACTS.BEYOND];
const layout = getLevelRegistry().getPresentationLayout();
const { chapterPositions } = layout;
const CH5 = chapterPositions[4];
const CH6 = chapterPositions[5];
const CH7 = chapterPositions[6];
const range = getChapterPathRange(6);

const camera = new THREE.PerspectiveCamera(BEYOND.fovBase, 16 / 9, 0.1, 20000);
const controller = new OdysseyCameraController(camera, getOdysseyPathCurve(), {
    levelPositions: layout.levelPositions,
    chapterPositions,
    startPosition: layout.levelPositions[0] ?? 0,
});
controller.directorCamera.followDistance = BEYOND.followDistance;
controller.directorCamera.fovBase = BEYOND.fovBase;

function frameAt(chapterId, progress) {
    const start = chapterPositions[chapterId - 1];
    const end = chapterPositions[chapterId] ?? 1;
    const inChapter = THREE.MathUtils.clamp((progress - start) / Math.max(1e-6, end - start), 0, 1);
    controller._activeFraming = resolveChapterFramingForProgress(chapterId, inChapter);
    const f = controller.computeFollowFrame(progress);
    return { camPos: f.camPos.clone(), lookTarget: f.lookTarget.clone(), up: f.normal.clone() };
}

/** Build a station's camera ONCE — the search projects hundreds of thousands of points. */
function station(chapterId, progress, aspect = 16 / 9) {
    const frame = frameAt(chapterId, progress);
    const cam = new THREE.PerspectiveCamera(BEYOND.fovBase, aspect, 0.1, 20000);
    cam.position.copy(frame.camPos);
    cam.up.copy(frame.up);
    cam.lookAt(frame.lookTarget);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return {
        cam,
        camPos: frame.camPos.clone(),
        fwd: frame.lookTarget.clone().sub(frame.camPos).normalize(),
    };
}
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
function projectAt(st, worldPoint) {
    // ⚠️ BEHIND-CAMERA CHECK IS NOT OPTIONAL. Projecting a point behind the camera returns
    // huge finite NDC (measured 1221 here), which a naive |ndc| < limit test reads as a
    // near-miss rather than as off-screen — an early sweep "solved" the fit with seven such
    // ghost points.
    _w.copy(worldPoint).sub(st.camPos);
    const behind = _w.dot(st.fwd) <= 0;
    _v.copy(worldPoint).project(st.cam);
    return {
        x: _v.x, y: _v.y, dist: _w.length(), behind,
    };
}
function project(frame, worldPoint, aspect = 16 / 9) {
    const cam = new THREE.PerspectiveCamera(BEYOND.fovBase, aspect, 0.1, 20000);
    cam.position.copy(frame.camPos);
    cam.up.copy(frame.up);
    cam.lookAt(frame.lookTarget);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const ndc = worldPoint.clone().project(cam);
    const fwd = frame.lookTarget.clone().sub(frame.camPos).normalize();
    const to = worldPoint.clone().sub(frame.camPos);
    return {
        x: ndc.x, y: ndc.y, behind: to.dot(fwd) <= 0, dist: to.length(),
    };
}

// Local → world for a chapter-6 group member (the group sits at the chapter's path centre).
const toWorld = (local) => new THREE.Vector3(
    range.center.x + local.x,
    range.center.y + local.y,
    range.center.z + local.z,
);

// LIVE values — read them from the module rather than transcribing, which is how the first
// run of this solver ended up fitting against a stale planetA (756) that Wave 1A had
// already re-solved to 870.
const { APPROACH } = await import('../src/rendering/odyssey/chapter-environments/cosmic-expanse.js');
const A = { x: APPROACH.planetA.x, y: APPROACH.planetA.y, z: APPROACH.planetA.z };
const B = { x: APPROACH.planetB.x, y: APPROACH.planetB.y, z: APPROACH.planetB.z };
const GAL_A = APPROACH.galaxyA;
const BH_A = { x: APPROACH.bhXa, y: APPROACH.bhYa, z: APPROACH.bhZa };
const BH_C = { x: APPROACH.bhXc, y: APPROACH.bhYc, z: APPROACH.bhZc };

// DERIVE the summit stations exactly as the shipped test does — it stopped using literals
// when Wave 1A re-spaced chapter 5, and solving against the old literals fits the wrong
// part of the climb.
const { SUMMIT_EARTH_REVEAL } = await import('../src/rendering/odyssey/chapter-environments/cosmic-expanse.js');
const SKY_SPAN = CH6 - CH5;
const IGNITE_START = CH6 - SKY_SPAN * SUMMIT_EARTH_REVEAL.startBeforeBoundary;
const IGNITE_END = CH6 - SKY_SPAN * SUMMIT_EARTH_REVEAL.endBeforeBoundary;
const SUMMIT = [0.30, 0.45, 0.60, 0.80, 1.0]
    .map((f) => IGNITE_START + (IGNITE_END - IGNITE_START) * f);
const SUMMIT_NDC_LIMIT = 0.87; // test asserts < 0.9; solve with margin

function score(a, b) {
    let worst = 0;
    const bad = [];
    // 1) Summit window (chapter 5): on screen, comfortably inside the frame, far away.
    SUMMIT.forEach((p) => {
        if (p >= CH6) return;
        const ease = 0; // pre-boundary the march sits at its A pose
        const local = new THREE.Vector3(
            a.x + (b.x - a.x) * ease,
            a.y + (b.y - a.y) * ease,
            a.z + (b.z - a.z) * ease,
        );
        const r = project(frameAt(5, p), toWorld(local));
        if (r.behind) { bad.push(`summit ${p} behind`); worst = Math.max(worst, 9); }
        const mx = Math.max(Math.abs(r.x), Math.abs(r.y));
        if (mx > SUMMIT_NDC_LIMIT) { bad.push(`summit ${p} ndc ${mx.toFixed(2)}`); worst = Math.max(worst, mx); }
        if (r.dist < 600) { bad.push(`summit ${p} dist ${r.dist.toFixed(0)}`); worst = Math.max(worst, 2); }
    });
    // 2) Chapter-6 entry: lower-centre-RIGHT third.
    const entry = project(frameAt(6, CH6), toWorld(new THREE.Vector3(a.x, a.y, a.z)));
    if (!(entry.x > 0.05)) { bad.push(`entry ndcX ${entry.x.toFixed(2)}`); worst = Math.max(worst, 3); }
    if (!(entry.y < 0)) { bad.push(`entry ndcY ${entry.y.toFixed(2)}`); worst = Math.max(worst, 3); }
    // ...and separated from the galaxy, which is also right-of-centre (shipped test).
    const gal = project(frameAt(6, CH6), toWorld(new THREE.Vector3(GAL_A.x, GAL_A.y, GAL_A.z)));
    if (!(Math.abs(entry.x - gal.x) > 0.32)) {
        bad.push(`entry vs galaxy ${Math.abs(entry.x - gal.x).toFixed(2)}`); worst = Math.max(worst, 3);
    }
    const bh = project(frameAt(6, CH6), toWorld(new THREE.Vector3(BH_A.x, BH_A.y, BH_A.z)));
    if (!(Math.abs(bh.x - entry.x) > 0.32)) {
        bad.push(`entry vs bh ${Math.abs(bh.x - entry.x).toFixed(2)}`); worst = Math.max(worst, 3);
    }
    // 3) Exit: framed, and clear of the black hole's dive line.
    const exit = project(frameAt(6, CH7), toWorld(new THREE.Vector3(b.x, b.y, b.z)));
    if (Math.max(Math.abs(exit.x), Math.abs(exit.y)) > 0.88) {
        bad.push(`exit ndc ${exit.x.toFixed(2)},${exit.y.toFixed(2)}`); worst = Math.max(worst, 4);
    }
    const bhExit = project(frameAt(6, CH7), toWorld(new THREE.Vector3(BH_C.x, BH_C.y, BH_C.z)));
    if (!(Math.abs(exit.x - bhExit.x) > 0.22)) {
        bad.push(`exit vs bh ${Math.abs(exit.x - bhExit.x).toFixed(2)}`); worst = Math.max(worst, 4);
    }
    // 4) The heroes must CLOSE on the camera, never shrink away (shipped test).
    if (!(exit.dist < entry.dist)) {
        bad.push(`not closing ${entry.dist.toFixed(0)}->${exit.dist.toFixed(0)}`); worst = Math.max(worst, 5);
    }
    return { ok: bad.length === 0, worst, bad, entry, exit };
}

console.log('current:', JSON.stringify(score(A, B).bad));

// FAST FEASIBILITY SWEEP with precomputed station cameras.
const ST_SUMMIT = SUMMIT.filter((p) => p < CH6).map((p) => ({ p, st: station(5, p) }));
const ST_ENTRY = station(6, CH6);
const ST_EXIT = station(6, CH7);
const galEntry = projectAt(ST_ENTRY, toWorld(new THREE.Vector3(GAL_A.x, GAL_A.y, GAL_A.z)));
const bhEntry = projectAt(ST_ENTRY, toWorld(new THREE.Vector3(BH_A.x, BH_A.y, BH_A.z)));
const bhExit = projectAt(ST_EXIT, toWorld(new THREE.Vector3(BH_C.x, BH_C.y, BH_C.z)));

// THE MARCH must stay in frame for the WHOLE chapter, at the narrowest aspect — the
// shipped test samples 13 progresses x 4 aspects and bounds |ndc| < 0.88. Scoring only the
// endpoints produced a pose that was framed at the seam and 1.01 (off-screen) beside it.
const MARCH = [];
for (let i = 0; i <= 12; i += 1) {
    const p = CH6 + ((CH7 - CH6) * i) / 12;
    MARCH.push({ ease: THREE.MathUtils.smoothstep(i / 12, 0, 1), st: station(6, p, 4 / 3) });
}

// planetA now only has to satisfy the BOUNDARY composition + the march — planetSummit
// owns the climb.
function fastScore(a) {
    for (let i = 0; i < MARCH.length; i += 1) {
        const { ease, st } = MARCH[i];
        const r = projectAt(st, toWorld(new THREE.Vector3(
            a.x + (B.x - a.x) * ease,
            a.y + (B.y - a.y) * ease,
            a.z + (B.z - a.z) * ease,
        )));
        if (r.behind) return false;
        if (Math.max(Math.abs(r.x), Math.abs(r.y)) > 0.86) return false;
    }
    const e = projectAt(ST_ENTRY, toWorld(new THREE.Vector3(a.x, a.y, a.z)));
    if (e.behind) return false;
    // Test thresholds, with only a hair of margin — wider margins emptied the band.
    if (!(e.x > 0.03) || !(e.y < -0.02)) return false;
    if (!(Math.abs(e.x - galEntry.x) > 0.31)) return false;
    if (!(Math.abs(bhEntry.x - e.x) > 0.31)) return false;
    const x = projectAt(ST_EXIT, toWorld(new THREE.Vector3(B.x, B.y, B.z)));
    if (!(Math.abs(x.x - bhExit.x) > 0.21)) return false;
    if (!(x.dist < e.dist)) return false;
    return true;
}

// Does the SHIPPED pose pass the march bound? If it does not, the bound (not the pose) is
// what needs revisiting — the corridor was rigidly translated, so the camera-to-hero
// geometry should be nearly unchanged and the entry miss was only 0.02.
console.log('march ndc for the CURRENT planetA (limit 0.88):');
MARCH.forEach(({ ease, st }, i) => {
    const r = projectAt(st, toWorld(new THREE.Vector3(
        A.x + (B.x - A.x) * ease, A.y + (B.y - A.y) * ease, A.z + (B.z - A.z) * ease,
    )));
    if (i % 3 === 0 || Math.max(Math.abs(r.x), Math.abs(r.y)) > 0.86) {
        console.log(`   i=${i} ease ${ease.toFixed(2)} ndc ${r.x.toFixed(2)}, ${r.y.toFixed(2)}${r.behind ? ' BEHIND' : ''}`);
    }
});
// ── THE TRIAD IS ONE FIT, NOT THREE ─────────────────────────────────────────────
// The galaxy landed at entry ndcX 0.286 after the re-map. The shipped test needs the
// planet > 0 AND ≥0.3 clear of the galaxy, i.e. planet.x < −0.014 — an empty band. So the
// galaxy must move right before the planet has anywhere to be. Solve it first, then solve
// the planet against the widened band. (This is why the original was a joint least-squares
// fit; a spline edit invalidates all three together.)
const GAL_B = APPROACH.galaxyB;
let bestGal = null;
let galFeasible = 0;
const galDistToday = projectAt(ST_ENTRY, toWorld(new THREE.Vector3(GAL_A.x, GAL_A.y, GAL_A.z))).dist;
// Box widened 2026-08-16 (Wave 1C): the ±300 box emptied after the look-ahead re-scale
// (0.01477 -> 0.01396) moved every station camera's aim slightly nearer.
for (let gx = GAL_A.x - 600; gx <= GAL_A.x + 700; gx += 20) {
    for (let gy = GAL_A.y - 500; gy <= GAL_A.y + 400; gy += 20) {
        for (let gz = GAL_A.z - 500; gz <= GAL_A.z + 500; gz += 20) {
            const g = { x: gx, y: gy, z: gz };
            const e = projectAt(ST_ENTRY, toWorld(new THREE.Vector3(g.x, g.y, g.z)));
            // 0.46 -> 0.33 (Wave 1C): the flyby's new entry tangent banks the early-march
            // cameras, so a galaxy right enough for 0.46 overflows 0.86 at 4:3 by station
            // 2-3 — measured: the 0.46 band is EMPTY over a ±600 u box. The shipped test's
            // real frontier is coupled (galaxy > 0.25, planet > 0, separation > 0.3), so a
            // galaxy at ~0.35 with the planet squeezed into (0, galaxy-0.31) is legal; the
            // planet sweep below enforces its half of the couple against the SOLVED galaxy.
            if (e.behind || !(e.x > 0.33) || !(e.y > 0.08)) continue;
            let framed = true;
            for (let i = 0; i < MARCH.length && framed; i += 1) {
                const { ease, st } = MARCH[i];
                const r = projectAt(st, toWorld(new THREE.Vector3(
                    g.x + (GAL_B.x - g.x) * ease,
                    g.y + (GAL_B.y - g.y) * ease,
                    g.z + (GAL_B.z - g.z) * ease,
                )));
                if (r.behind || Math.max(Math.abs(r.x), Math.abs(r.y)) > 0.86) framed = false;
            }
            if (!framed) continue;
            galFeasible += 1;
            const err = Math.abs(e.dist - galDistToday);
            if (!bestGal || err < bestGal.err) bestGal = { g, err, e };
        }
    }
}
if (bestGal) {
    console.log(`\nSOLVED galaxyA (${galFeasible} feasible points): { x: ${bestGal.g.x}, y: ${bestGal.g.y}, z: ${bestGal.g.z}, s: 155 },`);
    console.log(`   entry ndc ${bestGal.e.x.toFixed(2)}, ${bestGal.e.y.toFixed(2)}  dist ${bestGal.e.dist.toFixed(0)} (was ${galDistToday.toFixed(0)})`);
    galEntry.x = bestGal.e.x;
} else {
    console.log('\nNo galaxyA solution — widen the box.');
}

const ENTRY_DIST_TODAY = projectAt(ST_ENTRY, toWorld(new THREE.Vector3(A.x, A.y, A.z))).dist;
console.log(`entry distance today: ${ENTRY_DIST_TODAY.toFixed(0)} u (apparent size to preserve)`);
let best = null;
let nearest = null;
let feasible = 0;
// LOCAL search around the shipped pose. The rigid corridor translation barely moved the
// camera-to-hero geometry (entry missed by 0.02), so the fix is a nudge, not a relocation —
// and a wide sweep with safety margins had emptied the thin feasible band entirely.
for (let ax = A.x - 200; ax <= A.x + 200; ax += 10) {
    for (let ay = A.y - 200; ay <= A.y + 200; ay += 10) {
        for (let az = A.z - 200; az <= A.z + 200; az += 10) {
            const a = { x: ax, y: ay, z: az };
            if (!fastScore(a)) continue;
            feasible += 1;
            // PREFER APPARENT SIZE, not proximity to the old coordinates. The original
            // solve's rule was "keep each hero's DISTANCE and change only direction", so the
            // tuned scale ramps still mean what they say; a pose 684 u away that happens to
            // be framed would silently resize the giant at the seam.
            const e = projectAt(ST_ENTRY, toWorld(new THREE.Vector3(ax, ay, az)));
            const sizeErr = Math.abs(e.dist - ENTRY_DIST_TODAY);
            if (!best || sizeErr < best.sizeErr) {
                best = {
                    a, sizeErr, move: Math.hypot(ax - A.x, ay - A.y, az - A.z), s: score(a, B),
                };
            }
        }
    }
}
console.log(`feasible grid points: ${feasible}`);

// ── planetSummit ────────────────────────────────────────────────────────────────
// If no single static pose satisfies BOTH the summit window and the boundary framing,
// the planet needs its own pre-boundary keyframe: the flyby's bank sweeps the camera's
// aim, so a fixed point cannot stay framed across it AND land lower-right at the seam.
// Solve a summit-only pose, preferring the one CLOSEST to planetA so the pre-boundary
// lerp into it is short and reads as parallax rather than as an object sliding.
{
    let bestSummit = null;
    for (let ax = -600; ax <= 1600; ax += 25) {
        for (let ay = -700; ay <= 900; ay += 25) {
            for (let az = -900; az <= 700; az += 25) {
                let good = true;
                for (let i = 0; i < ST_SUMMIT.length && good; i += 1) {
                    const r = projectAt(ST_SUMMIT[i].st, toWorld(new THREE.Vector3(ax, ay, az)));
                    if (r.behind || r.dist < 600) { good = false; break; }
                    if (Math.max(Math.abs(r.x), Math.abs(r.y)) > SUMMIT_NDC_LIMIT) good = false;
                }
                if (!good) continue;
                const move = Math.hypot(ax - A.x, ay - A.y, az - A.z);
                if (!bestSummit || move < bestSummit.move) bestSummit = { a: { x: ax, y: ay, z: az }, move };
            }
        }
    }
    if (bestSummit) {
        const { a } = bestSummit;
        console.log(`\nSOLVED planetSummit (a pre-boundary keyframe, ${bestSummit.move.toFixed(0)} u from planetA):`);
        console.log(`    planetSummit: { x: ${a.x}, y: ${a.y}, z: ${a.z} },`);
        ST_SUMMIT.forEach(({ p, st }) => {
            const r = projectAt(st, toWorld(new THREE.Vector3(a.x, a.y, a.z)));
            console.log(`      p=${p} ndc ${r.x.toFixed(2)}, ${r.y.toFixed(2)}  dist ${r.dist.toFixed(0)}`);
        });
    } else {
        console.log('\nNo summit-only pose either — the summit stations themselves conflict.');
    }
}
// REFINE around the coarse winner — a 50 u grid missed by 0.01 of NDC on one station.
if (nearest) {
    const c = best ? best.a : nearest.a;
    for (let dx = -70; dx <= 70; dx += 10) {
        for (let dy = -70; dy <= 70; dy += 10) {
            for (let dz = -70; dz <= 70; dz += 10) {
                const a = { x: c.x + dx, y: c.y + dy, z: c.z + dz };
                const s = score(a, B);
                if (!s.ok) continue;
                const move = Math.hypot(a.x - A.x, a.y - A.y, a.z - A.z);
                if (!best || move < best.move) best = { a, move, s };
            }
        }
    }
}
if (!best && nearest) {
    console.log('\nNEAREST MISS:', JSON.stringify(nearest.a), '\n  unmet:', JSON.stringify(nearest.s.bad));
}

if (!best) {
    console.log('NO SOLUTION in the swept range — widen it or revisit the constraints.');
} else {
    console.log(`\nSOLVED planetA (moved ${best.move.toFixed(0)} u):`);
    console.log(`    planetA: { x: ${best.a.x}, y: ${best.a.y}, z: ${best.a.z}, s: 34 / 28 },`);
    console.log(`    planetB: { x: ${B.x}, y: ${B.y}, z: ${B.z}, s: 60 / 28 },`);
    console.log(`  entry ndc ${best.s.entry.x.toFixed(2)}, ${best.s.entry.y.toFixed(2)}`);
    console.log(`  exit  ndc ${best.s.exit.x.toFixed(2)}, ${best.s.exit.y.toFixed(2)}`);
}

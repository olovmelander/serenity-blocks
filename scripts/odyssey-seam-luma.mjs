/**
 * THE SEAM CONTINUITY METRIC.
 *
 * docs/ODYSSEY_ACT2_TO_SPACE_TRANSITION_PLAN_2026-08.md, Wave 0. The Act II -> Space overhaul
 * is judged on one question: does the frame's brightness travel smoothly across the seam, or
 * does it plateau and then fall off a cliff? This turns that question into a number so each
 * wave has a gate instead of an opinion.
 *
 * It reads the `meanLuma` the capture harness now writes into every frame sidecar, so it
 * needs no PNG decoder and works on any capture already on disk.
 *
 * ⚠️ PASS `--dir` AND `--boundary`. Both defaults are traps: `resolveDir()` returns the
 * ALPHABETICALLY last `seam-5-6*` directory rather than the newest, so an arm named
 * `seam-5-6-v2` silently becomes the graded run; and the default boundary is pre-ascent.
 *
 *   node scripts/odyssey-seam-luma.mjs --dir <artifact dir>  # ALWAYS name the dir
 *   node scripts/odyssey-seam-luma.mjs --dir <artifact dir>
 *   node scripts/odyssey-seam-luma.mjs --dir <arm> --boundary 0.7401   # ALWAYS pass both
 *
 * Exits non-zero when a threshold is violated, so a wave gate can be a command.
 *
 * BASELINE AT AUDIT TIME (2026-08-16, the defect this exists to retire):
 *   maxStep 89.3 at p=0.678 (the One World act gate), and 74% of the total change
 *   concentrated in the final third of the window.
 *
 * ⚠️ THE 0.678 ABOVE IS PRE-ASCENT and is preserved only as the historical record.
 * The ascent moved every boundary: ch6 is now 0.7401 and the One World act gate (worldOff)
 * is 0.7623. Progress after the limb rebuild, same metric, arm-limb-v2:
 *   maxStep -27.4, tailShare 15.8%, endLuma 22.5 — 3 of 4 gates pass; 2 rising steps remain.
 */
/* eslint-disable no-console */
import { readdir, readFile } from 'fs/promises';
import path from 'path';

const args = Object.fromEntries(
    process.argv.slice(2).flatMap((tok, i, all) => {
        if (!tok.startsWith('--')) return [];
        const key = tok.replace(/^--/, '');
        const next = all[i + 1];
        return [[key, next && !next.startsWith('--') ? next : true]];
    }),
);

const ROOT = process.cwd();
const ARTIFACT_ROOT = path.join(ROOT, 'artifacts', 'odyssey', 'wave-v');
// ⚠️ PER UNIT PROGRESS, NOT PER SAMPLE. The first version budgeted a raw sample-to-sample
// delta, which silently made the score depend on how the capture was configured: widen the
// window or drop the frame count and the same footage scores worse, with nothing in the
// output saying why. That is the same defect as the corridor-smoothness guard this project
// already carries (3 deg per 0.003 p, which reads worse purely because a longer journey makes
// 0.003 p cover more ground). The budget is now luma per 0.01 of progress, so window width and
// sample count cannot move it — which is what let the seam capture be widened to cover the
// systems actually under measurement instead of just the ecotone's own half-width.
const MAX_STEP = Number(args['max-step'] ?? 45);
const STEP_REFERENCE_DP = 0.01;
// ⚠️ 0.648 IS THE PRE-ASCENT BOUNDARY and is kept ONLY as a fallback for old captures.
// The live 5->6 boundary is 0.7401, and 0.648 now sits BELOW the window's first station
// (0.6801) — which silently turns the "no rising steps after the boundary" check into "no
// rising steps anywhere", reporting 7 rises where the real count against the boundary is 2.
// ALWAYS pass --boundary explicitly. Deriving it here was considered and rejected: this
// script must stay able to score archived captures taken under a different layout.
const BOUNDARY = Number(args.boundary ?? 0.648);
// How much of the total change is allowed to land in the last third of the window.
const MAX_TAIL_SHARE = Number(args['max-tail-share'] ?? 0.5);
// The transition must actually COMPLETE inside the window. Without this a change that simply
// drags Act II's brightness past the sampled range scores a perfect smooth curve — measured
// 2026-08-16, a 2.5x cloud-bank exit "passed" at maxStep 38.8 while leaving the last frame at
// luma 201 instead of space's ~26, i.e. it removed the cliff by never arriving.
// (Post-ascent, space settles at ~22.5 rather than ~26 — measured at p=0.8001, arm-limb-v2.)
const MAX_END_LUMA = Number(args['max-end-luma'] ?? 60);

async function resolveDir() {
    if (args.dir) return path.resolve(ROOT, String(args.dir));
    const entries = await readdir(ARTIFACT_ROOT, { withFileTypes: true }).catch(() => []);
    const seams = entries.filter((e) => e.isDirectory() && e.name.startsWith('seam-5-6'));
    if (!seams.length) throw new Error(`No seam-5-6 capture under ${ARTIFACT_ROOT}. Run the seam capture first.`);
    return path.join(ARTIFACT_ROOT, seams[seams.length - 1].name);
}

/** p is encoded in the filename as e.g. seam-5-6-0p7401.json */
function progressFromName(name) {
    const m = name.match(/(\d)p(\d+)/);
    if (!m) return null;
    return Number(`${m[1]}.${m[2]}`);
}

async function main() {
    const dir = await resolveDir();
    const files = (await readdir(dir))
        .filter((f) => f.endsWith('.json') && /\dp\d/.test(f))
        .sort();

    const parsed = await Promise.all(files.map(async (f) => {
        const data = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
        return { p: progressFromName(f), luma: data.meanLuma };
    }));
    const samples = parsed
        .filter((s) => s.p !== null && typeof s.luma === 'number')
        .sort((a, b) => a.p - b.p);

    console.log(`[seam-luma] ${path.relative(ROOT, dir)}  (${samples.length} samples)`);
    if (samples.length < 3) {
        console.error('[seam-luma] FAIL: need at least 3 samples with meanLuma.');
        console.error('[seam-luma] Captures taken before frameLuma() was added carry no meanLuma — re-capture.');
        process.exit(2);
    }

    let maxStep = { rate: 0 };
    let total = 0;
    const steps = [];
    for (let i = 1; i < samples.length; i += 1) {
        const d = samples[i].luma - samples[i - 1].luma;
        const dp = Math.max(1e-6, samples[i].p - samples[i - 1].p);
        // Normalised to a reference span so uneven sampling cannot flatter or punish a run.
        const rate = d * (STEP_REFERENCE_DP / dp);
        steps.push({
            from: samples[i - 1].p, to: samples[i].p, d, rate,
        });
        total += Math.abs(d);
        if (Math.abs(rate) > Math.abs(maxStep.rate)) {
            maxStep = {
                rate, d, at: samples[i].p, dp,
            };
        }
    }

    for (const s of samples) {
        const mark = s.p <= BOUNDARY ? ' ' : '*';
        console.log(`  p=${s.p.toFixed(4)}${mark} luma ${s.luma.toFixed(2)}`);
    }

    // Concentration: how much of the total movement lands in the final third of the window.
    const tailStart = Math.floor(steps.length * (2 / 3));
    const tail = steps.slice(tailStart).reduce((a, s) => a + Math.abs(s.d), 0);
    const tailShare = total > 0 ? tail / total : 0;

    // Monotonic after the boundary: leaving the world should not brighten again.
    // A magnitude floor, because the widened window now includes the flat space tail where
    // frames sit around luma 15 and run-to-run noise is worth ~1. Without it the check fires
    // on a 1.1-luma wobble between two black frames and calls the transition non-monotonic.
    const rises = steps.filter((s) => s.from >= BOUNDARY && s.rate > 3.0);

    console.log('');
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    console.log(`  maxStep       ${maxStep.rate.toFixed(1)} luma per 0.01p at p=${(maxStep.at ?? 0).toFixed(4)}`
        + `   (raw ${(maxStep.d ?? 0).toFixed(1)} over dp=${(maxStep.dp ?? 0).toFixed(4)})   (limit ${MAX_STEP})`);
    console.log(`  tailShare     ${pct(tailShare)} of movement in the last third   (limit ${pct(MAX_TAIL_SHARE)})`);
    console.log(`  postBoundary  ${rises.length} rising step(s) after p=${BOUNDARY}   (limit 0)`);
    console.log(`  endLuma       ${samples[samples.length - 1].luma.toFixed(1)}   (limit ${MAX_END_LUMA} — must actually reach space)`);

    const failures = [];
    if (Math.abs(maxStep.rate) > MAX_STEP) {
        failures.push(`maxStep ${maxStep.rate.toFixed(1)} luma/0.01p exceeds ${MAX_STEP}`);
    }
    if (tailShare > MAX_TAIL_SHARE) {
        failures.push(`tailShare ${(tailShare * 100).toFixed(1)}% exceeds ${(MAX_TAIL_SHARE * 100).toFixed(0)}%`);
    }
    if (rises.length) failures.push(`${rises.length} rising step(s) after the boundary`);
    const endLuma = samples[samples.length - 1].luma;
    if (endLuma > MAX_END_LUMA) {
        failures.push(`window ends at luma ${endLuma.toFixed(1)}, above ${MAX_END_LUMA} — the transition never completes`);
    }

    console.log('');
    if (failures.length) {
        console.error(`[seam-luma] FAIL: ${failures.join('; ')}`);
        process.exit(1);
    }
    console.log('[seam-luma] PASS');
}

main().catch((error) => {
    console.error(`[seam-luma] ${error.message}`);
    process.exit(2);
});

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
 *   node scripts/odyssey-seam-luma.mjs                       # newest seam-5-6 capture
 *   node scripts/odyssey-seam-luma.mjs --dir <artifact dir>
 *   node scripts/odyssey-seam-luma.mjs --max-step 45 --boundary 0.648
 *
 * Exits non-zero when a threshold is violated, so a wave gate can be a command.
 *
 * BASELINE AT AUDIT TIME (2026-08-16, the defect this exists to retire):
 *   maxStep 89.3 at p=0.678 (the One World act gate), and 74% of the total change
 *   concentrated in the final third of the window.
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
const MAX_STEP = Number(args['max-step'] ?? 45);
const BOUNDARY = Number(args.boundary ?? 0.648);
// How much of the total change is allowed to land in the last third of the window.
const MAX_TAIL_SHARE = Number(args['max-tail-share'] ?? 0.5);

async function resolveDir() {
    if (args.dir) return path.resolve(ROOT, String(args.dir));
    const entries = await readdir(ARTIFACT_ROOT, { withFileTypes: true }).catch(() => []);
    const seams = entries.filter((e) => e.isDirectory() && e.name.startsWith('seam-5-6'));
    if (!seams.length) throw new Error(`No seam-5-6 capture under ${ARTIFACT_ROOT}. Run the seam capture first.`);
    return path.join(ARTIFACT_ROOT, seams[seams.length - 1].name);
}

/** p is encoded in the filename as e.g. seam-5-6-0p6480.json */
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

    let maxStep = { d: 0 };
    let total = 0;
    const steps = [];
    for (let i = 1; i < samples.length; i += 1) {
        const d = samples[i].luma - samples[i - 1].luma;
        steps.push({ from: samples[i - 1].p, to: samples[i].p, d });
        total += Math.abs(d);
        if (Math.abs(d) > Math.abs(maxStep.d)) maxStep = { d, at: samples[i].p };
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
    const rises = steps.filter((s) => s.from >= BOUNDARY && s.d > 1.0);

    console.log('');
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    console.log(`  maxStep       ${maxStep.d.toFixed(1)} at p=${(maxStep.at ?? 0).toFixed(4)}   (limit ${MAX_STEP})`);
    console.log(`  tailShare     ${pct(tailShare)} of movement in the last third   (limit ${pct(MAX_TAIL_SHARE)})`);
    console.log(`  postBoundary  ${rises.length} rising step(s) after p=${BOUNDARY}   (limit 0)`);

    const failures = [];
    if (Math.abs(maxStep.d) > MAX_STEP) failures.push(`maxStep ${maxStep.d.toFixed(1)} exceeds ${MAX_STEP}`);
    if (tailShare > MAX_TAIL_SHARE) {
        failures.push(`tailShare ${(tailShare * 100).toFixed(1)}% exceeds ${(MAX_TAIL_SHARE * 100).toFixed(0)}%`);
    }
    if (rises.length) failures.push(`${rises.length} rising step(s) after the boundary`);

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

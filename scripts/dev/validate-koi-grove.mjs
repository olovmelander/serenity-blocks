/**
 * Objective validator for a Koi Pond GROVE_LAYOUT.
 * Checks the hard constraints + the composition metrics the judge panel used.
 *
 *   node validate-grove.mjs <path-to-json-array>
 */
import fs from 'node:fs';

const CAM = [0, 17.6, 27.4];
const TGT = [0, 1.2, -5.5];
const FOV = (42 * Math.PI) / 180;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

const fwd = norm(sub(TGT, CAM));
const right = norm(cross(fwd, [0, 1, 0]));
const up = cross(right, fwd);
const t = Math.tan(FOV / 2);

function project(x, y, z, aspect) {
    const v = sub([x, y, z], CAM);
    const vz = dot(v, fwd);
    return {
        x: dot(v, right) / (vz * t * aspect),
        y: dot(v, up) / (vz * t),
        vz,
    };
}

function analyze(trees, aspect, label) {
    let leftArea = 0; let rightArea = 0;
    let offFrame = 0;
    const tops = [];
    trees.forEach(([x, z, h]) => {
        const p = project(x, h * 0.72, z, aspect);
        if (p.vz <= 0) return;
        // Approximate projected ink: crown radius ~0.45h at distance vz.
        const r = (0.45 * h) / (p.vz * t);
        const area = Math.PI * r * r;
        if (Math.abs(p.x) > 1.12) offFrame += 1;
        if (p.x < 0) leftArea += area; else rightArea += area;
        tops.push(p.y);
    });
    const ratio = leftArea > 0 ? rightArea / leftArea : Infinity;
    const skylineSd = tops.length
        ? Math.sqrt(tops.reduce((s, v) => s + (v - tops.reduce((a, b) => a + b, 0) / tops.length) ** 2, 0) / tops.length)
        : 0;
    return {
        label, n: trees.length, ratio: +ratio.toFixed(2), offFrame, skylineSd: +skylineSd.toFixed(3),
    };
}

function clarkEvans(trees) {
    const n = trees.length;
    const nn = trees.map(([x1, z1], i) => {
        let best = Infinity;
        trees.forEach(([x2, z2], j) => {
            if (i === j) return;
            const d = Math.hypot(x1 - x2, z1 - z2);
            if (d < best) best = d;
        });
        return best;
    });
    const mean = nn.reduce((a, b) => a + b, 0) / n;
    const xs = trees.map((tr) => tr[0]); const zs = trees.map((tr) => tr[1]);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
    const expected = 0.5 / Math.sqrt(n / area);
    return {
        meanNN: +mean.toFixed(2),
        maxNN: +Math.max(...nn).toFixed(2),
        clarkEvans: +(mean / expected).toFixed(3),
    };
}

const trees = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(`\n=== GROVE VALIDATION (${trees.length} trees) ===\n`);

// Hard constraints
const nearLeft = trees.filter(([x, z]) => x < -20 && z > -32);
const board = trees.filter(([x, z]) => Math.abs(x) < 9 && z > -26);
// Depth-adaptive: the visible x-band widens as z recedes, so a flat cap
// false-positives on legitimately on-screen distant trees.
const visibleMaxX = (z) => Math.min(48, 0.88 * (21 + Math.abs(z) * 0.575));
const wide = trees.filter(([x, z]) => Math.abs(x) > visibleMaxX(z));
console.log('HARD CONSTRAINTS');
console.log('  near-left violations (x<-20 & z>-32):', nearLeft.length, nearLeft.length ? JSON.stringify(nearLeft) : 'OK');
console.log('  board sanctuary  (|x|<9 & z>-26)   :', board.length, board.length ? JSON.stringify(board) : 'OK');
console.log('  beyond depth-adaptive visible band  :', wide.length, wide.length ? JSON.stringify(wide) : 'OK');

// Occlusion of hero props (troll -15,-18.4 ; lantern 13.8,-20)
const blocks = (px, pz) => trees.filter(([x, z, h]) => {
    const p = project(x, h * 0.5, z, 1.78);
    const hero = project(px, 2, pz, 1.78);
    return p.vz < hero.vz && Math.abs(p.x - hero.x) < 0.055 && Math.abs(p.y - hero.y) < 0.14;
});
console.log('  trees occluding TROLL              :', blocks(-15, -18.4).length);
console.log('  trees occluding LANTERN            :', blocks(13.8, -20).length);

console.log('\nSPATIAL / NATURALISM');
const ce = clarkEvans(trees);
console.log(`  mean nearest-neighbour: ${ce.meanNN}  max: ${ce.maxNN}`);
console.log(`  Clark-Evans R: ${ce.clarkEvans}  (<1 = clustered GOOD, >1 = over-regular BAD)`);

console.log('\nBALANCE BY PROJECTED SCREEN AREA (right:left) + SKYLINE VARIETY');
[[8, '16:9'], [12, '16:9'], [20, '16:9'], [30, '16:9'], [42, '16:9'], [trees.length, '16:9'], [trees.length, '16:10']]
    .forEach(([n, ar]) => {
        const aspect = ar === '16:9' ? 1.78 : 1.6;
        const r = analyze(trees.slice(0, n), aspect, `first ${n} @${ar}`);
        const verdict = r.ratio > 2.6 ? '  <-- LOPSIDED' : '';
        console.log(`  ${r.label.padEnd(22)} R:L=${String(r.ratio).padStart(5)}  offFrame=${r.offFrame}  skylineSd=${r.skylineSd}${verdict}`);
    });

const species = trees.reduce((acc, tr) => { acc[tr[3]] = (acc[tr[3]] || 0) + 1; return acc; }, {});
console.log('\nSPECIES MIX (0=birch 1=fir):', JSON.stringify(species));
const heights = trees.map((tr) => tr[2]);
console.log('HEIGHTS: min', Math.min(...heights), 'max', Math.max(...heights));
console.log('');

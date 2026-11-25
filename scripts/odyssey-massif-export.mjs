/**
 * What the massif's Blender bake needs from the world, written as one binary file
 * (scripts/blender/odyssey/odyssey_massif.py runs this itself; nothing is kept in the tree):
 *
 *   node scripts/odyssey-massif-export.mjs <out.bin> [n]
 *
 * Layout (little-endian): a JSON header (uint32 length + UTF-8), then Float32 arrays:
 *   base   n x n, row j = z, column i = x: the ground the massif's form is laid over
 *          (macro + relief x detail weight: the drawn height without the sculpted delta, the
 *          tarn's carve or the north lake's), on ODYSSEY_SCULPT_PLATE's square;
 *   macro  n x n, the smooth macro form alone (the cones the massif's design is drawn relative to);
 *   old    n x n, the summit's sculpt the form replaces (odysseySummitSculpt), for the before picture;
 *   rail   the rail across Act II as (p, x, y, z) rows, every 0.0005 of progress;
 *   air    (x, y, z) rows of the air things fly through near the massif (the summit's vultures over a
 *          lap), which the form keeps under them as it keeps under the rail.
 * The header carries the plate's square, the massifs and the tarn's outline.
 */
import { writeFileSync } from 'fs';
import {
    ODYSSEY_MASSIFS,
    ODYSSEY_SCULPT_PLATE,
    ODYSSEY_TARN,
    odysseySummitSculpt,
    odysseyWorldDetailWeight,
    odysseyWorldMacro,
    odysseyWorldRelief,
} from '../src/rendering/odyssey/world/odyssey-world-height.js';
import { getActiveOdysseyChapterPositions, getOdysseyWorldRailPointAt } from '../src/rendering/odyssey/path-utils.js';
import {
    SUMMIT_BIRDS,
    resolveSummitBirdLanes,
    summitBirdPositionAt,
} from '../src/rendering/odyssey/composition/odyssey-summit-birds.js';

const out = process.argv[2];
const n = Number.parseInt(process.argv[3] || '400', 10);
if (!out) {
    console.error('usage: node scripts/odyssey-massif-export.mjs <out.bin> [n]');
    process.exit(2);
}

const S = ODYSSEY_SCULPT_PLATE;
const step = S.extent / (n - 1);
const x0 = S.x - (S.extent / 2);
const z0 = S.z - (S.extent / 2);
const base = new Float32Array(n * n);
const old = new Float32Array(n * n);
const macro = new Float32Array(n * n);
for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
        const x = x0 + (i * step);
        const z = z0 + (j * step);
        base[(j * n) + i] = odysseyWorldMacro(x, z) + (odysseyWorldRelief(x, z) * odysseyWorldDetailWeight(x, z));
        old[(j * n) + i] = odysseySummitSculpt(x, z);
        macro[(j * n) + i] = odysseyWorldMacro(x, z);
    }
}

const cp = getActiveOdysseyChapterPositions();
const rows = [];
for (let p = cp[1]; p <= cp[5] + 1e-9; p += 0.0005) {
    const pt = getOdysseyWorldRailPointAt(p);
    rows.push(p, pt.x, pt.y, pt.z);
}
const rail = new Float32Array(rows);
const airRows = [];
resolveSummitBirdLanes().forEach((lane) => {
    for (let t = 0; t < SUMMIT_BIRDS.lapSeconds * 1.3; t += 1) {
        const q = summitBirdPositionAt(lane, t);
        airRows.push(q.x, q.y, q.z);
    }
});
const air = new Float32Array(airRows);

const header = Buffer.from(JSON.stringify({
    n,
    x0,
    z0,
    step,
    extent: S.extent,
    centre: [S.x, S.z],
    massifs: ODYSSEY_MASSIFS,
    tarn: { waterY: ODYSSEY_TARN.waterY, outline: ODYSSEY_TARN.outline },
    chapterPositions: cp,
    railRows: rows.length / 4,
    airRows: airRows.length / 3,
}));
const len = Buffer.alloc(4);
len.writeUInt32LE(header.length, 0);
writeFileSync(out, Buffer.concat([len, header, Buffer.from(base.buffer), Buffer.from(macro.buffer), Buffer.from(old.buffer), Buffer.from(rail.buffer), Buffer.from(air.buffer)]));
console.log(`massif export: ${n}x${n} base, ${rows.length / 4} rail rows -> ${out}`);

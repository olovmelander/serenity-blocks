/**
 * THE ARCHIPELAGO'S CALIBRATION SIM — run from the repo root: node scripts/act2-forest-arch-calibrate.mjs
 *
 * This file AUTHORED the FOREST_ARCH_T_BY_AREA table in odyssey-forest-scatter.js: it
 * calibrates each area's woods-field threshold as a percentile of that area's own eligible
 * pool, prints the table at full precision, and measures the resulting carve. If ANY upstream
 * stage changes (terrain weights, the density mask, the three-term thin, the glade, a salt,
 * a kill fraction), re-run this and transcribe the FULL-PRECISION thresholds verbatim — the
 * 3-decimal display values once flipped six borderline trees. Never hand-tune the table.
 */
/**
 * THE PAINTER — "ARCHIPELAGO": the island stops being a carpet with regional colour and
 * becomes an archipelago of big closed stands with real meadows between them.
 *
 * Mechanism = ONE deterministic keep/kill predicate over the final placements array
 * (exactly implementable as a filter after pickSpecies/glade, before LOD assignment —
 * downstream is fully site-local, verified by the mechanism audit):
 *   Stage C  authored set-pieces (hero meadow on the ch4 rail, lone-tree hill, gold-finger
 *            meadows interlocking the north seam) — explicit shapes, hard cores, feathered rims.
 *   Stage A  WOODS field: two-octave patch noise, per-area HARD threshold calibrated by
 *            percentile against that area's own pool values (rate exact by construction —
 *            the mean-preservation trap cannot occur), feathered treeline rim below T,
 *            sparse resurrected singles just past T (the pioneer fringe).
 *   Protections: rail corridor d<=520 (Stage A never), framing, blossom grove, the cypress
 *            grove disc, and the autumn shore terrace (the owner's red-maple band).
 * Salts used: 47 (octave A), 53 (octave B), 61 (rim coin), 67 (singles coin), 73 (set-piece
 * rim coin). All free per the salt ledger (29/31/71/91/137/23/17+7i/1-13 taken).
 */
import {
    scatterZonedForest, buildShoreDistance, FOREST_CHUNK_BY_LOD,
} from '../src/rendering/odyssey/world/odyssey-forest-scatter.js';
import {
    odysseyWorldDetailWeight, odysseyWorldMacro, odysseyWorldRelief,
} from '../src/rendering/odyssey/world/odyssey-world-height.js';
import { getOdysseyPathPointAt } from '../src/rendering/odyssey/path-utils.js';

const heightAt = (x, z) => odysseyWorldMacro(x, z)
    + (odysseyWorldRelief(x, z) * odysseyWorldDetailWeight(x, z));
const rail = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));
const railDist = (x, z) => {
    let best = Infinity;
    for (const p of rail) {
        const d = ((x - p.x) ** 2) + ((z - p.z) ** 2);
        if (d < best) best = d;
    }
    return Math.sqrt(best);
};
// EXACT copies of the scatter's own hash + patch noise (so the shipped code reuses them).
function hash2(i, j, salt) {
    let h = ((i | 0) * 374761393) + ((j | 0) * 668265263) + (salt * 2654435761);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function patchNoise(x, z, cell, salt) {
    const gx = x / cell; const gz = z / cell;
    const i0 = Math.floor(gx); const j0 = Math.floor(gz);
    const fx = gx - i0; const fz = gz - j0;
    const sx = fx * fx * (3 - (2 * fx)); const sz = fz * fz * (3 - (2 * fz));
    const a = hash2(i0, j0, salt); const b = hash2(i0 + 1, j0, salt);
    const c = hash2(i0, j0 + 1, salt); const d = hash2(i0 + 1, j0 + 1, salt);
    return (((a * (1 - sx)) + (b * sx)) * (1 - sz)) + (((c * (1 - sx)) + (d * sx)) * sz);
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const AXIS = [0.891, -0.455]; const SPLIT = 295;
const shoreAt = buildShoreDistance(heightAt, 287.31);
const regionAt = (x, z) => {
    const wander = (patchNoise(x, z, 900, 91) - 0.5) * 300;
    const along = (x * AXIS[0]) + (z * AXIS[1]);
    return clamp01(((along - (SPLIT + wander)) / 420) + 0.5);
};
function areaOf(x, z, d) {
    const along = (x * AXIS[0]) + (z * AXIS[1]);
    if (d <= 520) return 'RAIL';
    if (z < -1500) return along > SPLIT ? 'NE' : 'NW';
    if (x > 700) return 'ETIP';
    if (along > SPLIT + 420) return 'EMASS';
    if (Math.abs(along - SPLIT) <= 420) return 'SEAM';
    if (x < -1200) return 'WEND';
    return 'WMID';
}

// archCarve OFF: the quantile pools must come from the UN-carved population, or a re-run
// would calibrate on top of the very carve it is calibrating and the thresholds would ratchet.
const comp = scatterZonedForest(heightAt, { rail, visibilityCull: false, archCarve: false });
const ship = scatterZonedForest(heightAt, { rail, visibilityCull: true, archCarve: false });
const tag = (t) => {
    const d = railDist(t.x, t.z);
    return { ...t, d, area: areaOf(t.x, t.z, d) };
};
const compT = comp.placements.map(tag);
const shipT = ship.placements.map(tag);

// ───────────────────────────── CONFIG (iterate me) ─────────────────────────────
const SALT_A = 47; const SALT_B = 53; const SALT_RIM = 61; const SALT_SINGLE = 67; const SALT_SP = 73;
const CELL_B = 190; const OCT_A = 0.62; const OCT_B = 0.38;
const RIM = 0.05; // field-units treeline feather below T (extra kills, ramped)
const SBAND = 0.055; // field-units past T where singles may survive
const P_SINGLE = 0.16; // survival rate inside the singles band
const AREA_CFG = {
    RAIL: { kill: 0.00, cellA: 430 },
    SEAM: { kill: 0.22, cellA: 430 },
    ETIP: { kill: 0.44, cellA: 430 },
    EMASS: { kill: 0.42, cellA: 430 },
    NE: { kill: 0.60, cellA: 430 },
    NW: { kill: 0.48, cellA: 430 },
    WEND: { kill: 0.42, cellA: 280 },
    WMID: { kill: 0.40, cellA: 430 },
};
// set-pieces
const MEADOW = {
    cx: -432, cz: -277, ux: -0.25, uz: -0.97, a: 190, b: 130, core: 0.72,
};
const LONE = {
    cx: -997.3, cz: -884.4, r: 110, keepR: 14,
};
const FINGERS = [
    { cx: -536, cz: -1412, r: 150 }, // green-side bite, seam s=-1500
    { cx: -395, cz: -1708, r: 140 }, // autumn-side bite, seam s=-1700
];
// protections
const CYP = { cx: -1086, cz: -1753, r: 240 };
// The autumn shore TERRACE: autumnBoost = gain*region*apron pays where apron is HIGH, i.e.
// one terrace ABOVE the green apron — shore 95..200u. Protect [45,200) so the owner's red
// maple run and the gold shoreline stay a continuous painted band under the finale camera.
const TERRACE = {
    region: 0.55, shoreLo: 45, shoreHi: 200, zMin: -1400,
};
// Stage A never kills the near field: fine-chunk-centre rail distance <= 520 is EXACTLY the
// non-far LOD set (tier-invariant; hero/mid split varies by tier but far does not).
const FOREST_CHUNK = 420;
const chunkCentreD = (x, z) => railDist(
    (Math.floor(x / FOREST_CHUNK) + 0.5) * FOREST_CHUNK,
    (Math.floor(z / FOREST_CHUNK) + 0.5) * FOREST_CHUNK,
);
// ────────────────────────────────────────────────────────────────────────────────

const woodsAt = (x, z, cellA) => (OCT_A * patchNoise(x, z, cellA, SALT_A))
    + (OCT_B * patchNoise(x, z, CELL_B, SALT_B));

// witness/lone snapping: print candidates once
const loneCands = compT.filter((t) => Math.hypot(t.x - LONE.cx, t.z - LONE.cz) < 40)
    .map((t) => `(${t.x.toFixed(1)}, ${t.z.toFixed(1)}) ${t.speciesId} d=${Math.hypot(t.x - LONE.cx, t.z - LONE.cz).toFixed(1)}`);
console.log(`lone-hill snap candidates near (${LONE.cx},${LONE.cz}): ${loneCands.slice(0, 5).join(' | ') || 'NONE'}`);
// The witness tree: snapped to a real placement inside the meadow (a mature shore-broadleaf),
// so the authored constant keeps exactly the tree it names.
const wfx = -468.7; const wfz = -418.4;
const witCands = compT.filter((t) => Math.hypot(t.x - wfx, t.z - wfz) < 50)
    .map((t) => `(${t.x.toFixed(1)}, ${t.z.toFixed(1)}) ${t.speciesId} d=${Math.hypot(t.x - wfx, t.z - wfz).toFixed(1)}`);
console.log(`meadow witness candidates near (${wfx.toFixed(0)},${wfz.toFixed(0)}): ${witCands.slice(0, 6).join(' | ') || 'NONE'}`);
const loneClump = compT.filter((t) => Math.hypot(t.x - LONE.cx, t.z - LONE.cz) < LONE.keepR).length;
console.log(`lone-hill trees within keepR ${LONE.keepR}: ${loneClump}`);
// prove chunk-centre rule == non-far LOD set
const mismatch = compT.filter((t) => (chunkCentreD(t.x, t.z) <= 520) !== (t.lod !== 'far') && !t.framing).length;
console.log(`chunk-centre-rule vs lod!==far mismatches (excl framing): ${mismatch}`);

// ── calibration: per-area threshold on the COMP pool (exempt trees excluded) ──
const isExempt = (t) => t.framing
    || t.speciesId === 'S7-pink-blossom'
    || chunkCentreD(t.x, t.z) <= 520
    || Math.hypot(t.x - CYP.cx, t.z - CYP.cz) < CYP.r
    || (regionAt(t.x, t.z) > TERRACE.region && t.z > TERRACE.zMin
        && shoreAt(t.x, t.z) >= TERRACE.shoreLo && shoreAt(t.x, t.z) < TERRACE.shoreHi);
const T_BY_AREA = {};
for (const [a, cfg] of Object.entries(AREA_CFG)) {
    if (cfg.kill <= 0) { T_BY_AREA[a] = Infinity; continue; }
    const pool = compT.filter((t) => t.area === a && t.d > 520 && !isExempt(t));
    const vals = pool.map((t) => woodsAt(t.x, t.z, cfg.cellA)).sort((p, q2) => p - q2);
    T_BY_AREA[a] = vals.length ? vals[Math.floor((1 - cfg.kill) * (vals.length - 1))] : Infinity;
}
console.log(`thresholds: ${JSON.stringify(Object.fromEntries(Object.entries(T_BY_AREA).map(([k, v]) => [k, Number.isFinite(v) ? +v.toFixed(3) : 'off'])))}`);
// FULL precision is what gets transcribed into FOREST_ARCH_T_BY_AREA — the 3-decimal display
// values above once flipped six borderline trees.
console.log(`FULL-PRECISION thresholds: ${JSON.stringify(T_BY_AREA)}`);

// ── the predicate ──
function painterKeep(t) {
    if (t.framing) return 'keep';
    if (t.speciesId === 'S7-pink-blossom') return 'keep';
    const rx = Math.round(t.x); const rz = Math.round(t.z);
    // Stage C: authored set-pieces (override everything else)
    // lone-tree hill
    {
        const dd = Math.hypot(t.x - LONE.cx, t.z - LONE.cz);
        if (dd < LONE.keepR) return 'keep';
        if (dd < LONE.r * 0.8) return 'lone';
        if (dd < LONE.r) {
            const rim = (dd - (LONE.r * 0.8)) / (LONE.r * 0.2);
            if (hash2(rx, rz, SALT_SP) > ((rim * 0.9) + 0.1)) return 'lone';
        }
    }
    // hero meadow (ellipse in rail frame)
    {
        const px = t.x - MEADOW.cx; const pz = t.z - MEADOW.cz;
        const lu = ((px * MEADOW.ux) + (pz * MEADOW.uz)) / MEADOW.a;
        const lv = ((px * -MEADOW.uz) + (pz * MEADOW.ux)) / MEADOW.b;
        const e = Math.sqrt((lu * lu) + (lv * lv));
        if (e < 1) {
            const wd = Math.hypot(t.x - wfx, t.z - wfz);
            if (wd < 10) return 'keep'; // the witness tree(s)
            if (e < MEADOW.core) return 'meadow';
            const rim = (e - MEADOW.core) / (1 - MEADOW.core);
            if (hash2(rx, rz, SALT_SP) > ((rim * 0.85) + 0.15)) return 'meadow';
        }
    }
    // gold fingers
    for (let f = 0; f < FINGERS.length; f += 1) {
        const F = FINGERS[f];
        const dd = Math.hypot(t.x - F.cx, t.z - F.cz);
        if (dd < F.r * 0.75) return 'finger';
        if (dd < F.r) {
            const rim = (dd - (F.r * 0.75)) / (F.r * 0.25);
            if (hash2(rx, rz, SALT_SP) > ((rim * 0.85) + 0.15)) return 'finger';
        }
    }
    // Stage A: woods field (pool only)
    if (t.d <= 520) return 'keep';
    if (isExempt(t)) return 'keep';
    const T = T_BY_AREA[t.area];
    if (!Number.isFinite(T)) return 'keep';
    const W = woodsAt(t.x, t.z, AREA_CFG[t.area].cellA);
    if (W > T + SBAND) return 'woods';
    if (W > T) {
        if (hash2(rx, rz, SALT_SINGLE) < P_SINGLE) return 'keep'; // pioneer single
        return 'woods';
    }
    if (W > T - RIM) {
        const rim = (W - (T - RIM)) / RIM;
        if (hash2(rx, rz, SALT_RIM) < rim * 0.8) return 'rim';
    }
    return 'keep';
}

const applyKill = (arr) => {
    const kept = []; const why = {};
    for (const t of arr) {
        const r = painterKeep(t);
        if (r === 'keep') kept.push(t);
        else why[r] = (why[r] || 0) + 1;
    }
    return { kept, why };
};
const compAfter = applyKill(compT);
const shipAfter = applyKill(shipT);

// ── measurements ──
const spec = (arr) => {
    const by = {};
    for (const t of arr) by[t.speciesId] = (by[t.speciesId] || 0) + 1;
    return by;
};
const contrast = (arr) => {
    const m = new Map();
    for (const t of arr) {
        const k = `${Math.floor(t.x / 120)}|${Math.floor(t.z / 120)}`;
        m.set(k, (m.get(k) || 0) + 1);
    }
    const v = [...m.values()].sort((a, b) => a - b);
    return v[Math.floor(0.9 * (v.length - 1))] / Math.max(1, v[Math.floor(0.5 * (v.length - 1))]);
};
const drawsOf = (arr) => {
    const set = new Set();
    for (const t of arr) {
        const edge = FOREST_CHUNK_BY_LOD[t.lod] ?? 420;
        set.add(`${Math.floor(t.x / edge)}|${Math.floor(t.z / edge)}|${t.lod}|${t.speciesId}`);
    }
    return set.size;
};
const hm = (arr) => arr.filter((t) => t.lod !== 'far').length;
const apronGreen = (arr) => {
    const sel = arr.filter((t) => shoreAt(t.x, t.z) < 45);
    const g = sel.filter((t) => ['S1-shore-broadleaf', 'S2-workhorse-pine', 'S3-subalpine-fir'].includes(t.speciesId)).length;
    return { n: sel.length, pct: (100 * g) / Math.max(1, sel.length) };
};

console.log(`\nkill reasons comp: ${JSON.stringify(compAfter.why)}`);
console.log(`kill reasons ship: ${JSON.stringify(shipAfter.why)}`);
console.log(`\nCOMP ${compT.length} -> ${compAfter.kept.length}   SHIP ${shipT.length} -> ${shipAfter.kept.length}  (${(100 * (1 - (shipAfter.kept.length / shipT.length))).toFixed(1)}% off shipped)`);
console.log(`hero+mid ship ${hm(shipT)} -> ${hm(shipAfter.kept)}   draws ship ${drawsOf(shipT)} -> ${drawsOf(shipAfter.kept)}   comp draws ${drawsOf(compT)} -> ${drawsOf(compAfter.kept)}`);
console.log(`east x>700 ship ${shipT.filter((t) => t.x > 700).length} -> ${shipAfter.kept.filter((t) => t.x > 700).length}   west x<-1200 ship ${shipT.filter((t) => t.x < -1200).length} -> ${shipAfter.kept.filter((t) => t.x < -1200).length}`);
console.log(`contrast(120u p90/p50) ship ${contrast(shipT).toFixed(2)} -> ${contrast(shipAfter.kept).toFixed(2)}   comp ${contrast(compT).toFixed(2)} -> ${contrast(compAfter.kept).toFixed(2)}`);
const agB = apronGreen(shipT); const agA = apronGreen(shipAfter.kept);
console.log(`apron<45u green ship ${agB.pct.toFixed(0)}% of ${agB.n} -> ${agA.pct.toFixed(0)}% of ${agA.n}`);
console.log(`species comp after: ${JSON.stringify(spec(compAfter.kept))}`);
console.log(`species ship after: ${JSON.stringify(spec(shipAfter.kept))}`);
const perArea = {};
for (const t of shipT) (perArea[t.area] = perArea[t.area] || [0, 0])[0] += 1;
for (const t of shipAfter.kept) (perArea[t.area] = perArea[t.area] || [0, 0])[1] += 1;
console.log(`per-area ship before->after: ${Object.entries(perArea).map(([a, [b, c]]) => `${a} ${b}->${c}`).join('  ')}`);

// ── maps ──
const RAMP = ' .:-=+*#%@';
function mapOf(arr, X0, X1, Z0, Z1, NX, NZ, label, fixedMax) {
    const grid = Array.from({ length: NZ }, () => new Array(NX).fill(0));
    for (const t of arr) {
        const i = Math.floor(((t.x - X0) / (X1 - X0)) * NX);
        const j = Math.floor(((t.z - Z0) / (Z1 - Z0)) * NZ);
        if (i >= 0 && i < NX && j >= 0 && j < NZ) grid[j][i] += 1;
    }
    const gmax = fixedMax || Math.max(...grid.flat(), 1);
    console.log(`\n${label} (cell ${((X1 - X0) / NX).toFixed(0)}x${((Z1 - Z0) / NZ).toFixed(0)}u, max ${gmax})`);
    for (let j = 0; j < NZ; j += 1) {
        console.log(`   ${grid[j].map((n) => (n === 0 ? ' ' : RAMP[Math.min(9, Math.max(1, Math.round((n / gmax) * 9)))])).join('')}`);
    }
    return gmax;
}
const mB = mapOf(shipT, -1950, 1250, -2350, -150, 80, 22, 'SHIP BEFORE');
mapOf(shipAfter.kept, -1950, 1250, -2350, -150, 80, 22, 'SHIP AFTER', mB);
mapOf(compAfter.kept, -1950, 1250, -2350, -150, 80, 22, 'COMP AFTER', mB);

// dominant species map (ship after) — regionalization must survive the cut
const LETTER = {
    'S1-shore-broadleaf': 'b',
    'S2-workhorse-pine': 'p',
    'S3-subalpine-fir': 'f',
    'S4-gold-birch': 'G',
    'S5-cypress-spike': 'c',
    'S6-red-maple': 'R',
    'S7-pink-blossom': 'B',
};
const NX = 80; const NZ = 22; const X0 = -1950; const X1 = 1250; const Z0 = -2350; const Z1 = -150;
const cells = Array.from({ length: NZ }, () => Array.from({ length: NX }, () => []));
for (const t of shipAfter.kept) {
    const i = Math.floor(((t.x - X0) / (X1 - X0)) * NX);
    const j = Math.floor(((t.z - Z0) / (Z1 - Z0)) * NZ);
    if (i >= 0 && i < NX && j >= 0 && j < NZ) cells[j][i].push(t);
}
console.log('\nDOMINANT SPECIES ship after (b broadleaf p pine f fir c cypress | G gold R maple B blossom)');
cells.forEach((row) => {
    const line = row.map((c) => {
        if (!c.length) return ' ';
        const by = {};
        c.forEach((t) => { by[t.speciesId] = (by[t.speciesId] || 0) + 1; });
        const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0][0];
        return LETTER[top] || '?';
    }).join('');
    console.log(`   ${line}`);
});

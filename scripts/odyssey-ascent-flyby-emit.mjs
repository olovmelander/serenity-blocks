/**
 * WAVE 1C — emit the flyby ascent + the level re-map.
 *
 * THE FINDING THAT SHAPED THIS. With the space corridor FROZEN, a close pass is
 * geometrically impossible to do smoothly: the massif sits ~443 u off every point of the
 * climb, and reaching it forces a there-and-back U-turn into a fixed cp20. Measured
 * frontier (scripts/odyssey-ascent-flyby-solve.mjs): 268 u costs a 12 deg/5.3u corner,
 * 203 u costs 14.4, 165 u costs 19.7 — against a 3.47 baseline. Shipping any of those
 * would trade the ride the owner just praised for a hairpin.
 *
 * THE FIX IS WAVE 1A'S OWN PATTERN: let the climb CONTINUE north past the peak and
 * rigidly TRANSLATE the space run to meet it. No U-turn, so no corner — measured 142 u at
 * a 5.4 deg bank, with the ch6 corridor guard IMPROVING (4.11 -> 3.76) because a rigid
 * translation preserves the corridor's shape bit-for-bit. The cloud limb is seated at
 * `getOdysseyPathPointAt(boundary)` (OdysseyBoardController.js:1946), so it follows the
 * moved rail and the owner's "keep the cloud transition" survives by construction.
 *
 * Usage: node scripts/odyssey-ascent-flyby-emit.mjs [--write]
 */
/* eslint-disable no-console */
import * as THREE from 'three';
import fs from 'node:fs';
import { ODYSSEY_LAYOUT_DATA } from '../src/core/odyssey/data/odyssey-layout.js';
import { LEVEL_CONFIGS } from '../src/core/odyssey/data/levels.js';
import { ODYSSEY_MASSIFS, odysseyWorldHeight } from '../src/rendering/odyssey/world/odyssey-world-height.js';

const HERO = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
const OLD_TOTAL = 2393.89;
const B = ODYSSEY_LAYOUT_DATA.controlPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));

// TUNED by the sweep in odyssey-ascent-flyby-solve.mjs, then refined here.
const SHIFT = new THREE.Vector3(-60, 0, -350); // rigid translation of the space run
const FLYBY_DIST = 170; // horizontal distance from the massif AXIS at closest approach
const FLYBY_BEARING = 0.30; // 0 = due south of the peak; +x is east
const FLYBY_Y = 1000;
const COUNT = 8; // regenerated points between cp15 and the translated cp20

function mk(points) {
    const c = new THREE.CatmullRomCurve3(points.map((p) => p.clone()));
    c.curveType = 'catmullrom';
    c.tension = 0.3;
    return c;
}
function arcOf(curve, target, n = 6000) {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i <= n; i += 1) {
        const u = i / n;
        const d = curve.getPointAt(u).distanceToSquared(target);
        if (d < bd) { bd = d; best = u; }
    }
    return best;
}

const PRE = B.slice(0, 16);
const TAIL = [B[20].clone().add(SHIFT), B[21].clone().add(SHIFT)];
const REST = B.slice(22).map((p) => p.clone().add(SHIFT));

const dir = new THREE.Vector3(FLYBY_BEARING, 0, Math.sqrt(1 - FLYBY_BEARING ** 2));
const toFly = new THREE.Vector3(
    HERO.x + dir.x * FLYBY_DIST,
    FLYBY_Y,
    HERO.z + dir.z * FLYBY_DIST,
);
const start = B[15].clone();
const approach = new THREE.Vector3(
    start.x + (toFly.x - start.x) * 0.55,
    start.y + (toFly.y - start.y) * 0.62,
    start.z + (toFly.z - start.z) * 0.55,
);
const exit = new THREE.Vector3(
    toFly.x + (TAIL[0].x - toFly.x) * 0.5,
    toFly.y + (TAIL[0].y - toFly.y) * 0.45,
    toFly.z + (TAIL[0].z - toFly.z) * 0.5,
);
const shaping = mk([B[14], start, approach, toFly, exit, TAIL[0], TAIL[1]]);
const t0 = arcOf(shaping, start);
const t1 = arcOf(shaping, TAIL[0]);
const ASCENT = [];
for (let i = 1; i <= COUNT; i += 1) {
    ASCENT.push(shaping.getPointAt(t0 + ((t1 - t0) * i) / (COUNT + 1)));
}

const NEW_POINTS = [...PRE, ...ASCENT, ...TAIL, ...REST];
const OLD_CURVE = mk(B);
const NEW_CURVE = mk(NEW_POINTS);
const NEW_TOTAL = NEW_CURVE.getLength();
const ADDED = NEW_TOTAL - OLD_TOTAL;

// ── measurements ────────────────────────────────────────────────────────────────
const step = 5.30 / NEW_TOTAL;
let minAxis = Infinity; let minAxisY = 0; let minClear = Infinity;
let climbMax = 0; let prev = null;
for (let t = 0; t <= 1; t += step) {
    const p = NEW_CURVE.getPointAt(t);
    const axis = Math.hypot(p.x - HERO.x, p.z - HERO.z);
    if (axis < minAxis) { minAxis = axis; minAxisY = p.y; }
    if (t >= 0.2) minClear = Math.min(minClear, p.y - odysseyWorldHeight(p.x, p.z));
    if (p.y < 620 || p.y > 1200) { prev = null; continue; }
    const tg = NEW_CURVE.getTangentAt(t).normalize();
    if (prev) climbMax = Math.max(climbMax, THREE.MathUtils.radToDeg(tg.angleTo(prev)));
    prev = tg;
}
const ch6s = (0.7401 * OLD_TOTAL + ADDED) / NEW_TOTAL;
const ch6e = (0.8634 * OLD_TOTAL + ADDED) / NEW_TOTAL;
let mx = 0; let tot = 0; let mty = Infinity; prev = null;
for (let t = ch6s; t <= ch6e + 1e-9; t += step) {
    const tg = NEW_CURVE.getTangentAt(Math.min(t, 1)).normalize();
    mty = Math.min(mty, tg.y);
    if (prev) { const d = THREE.MathUtils.radToDeg(tg.angleTo(prev)); mx = Math.max(mx, d); tot += d; }
    prev = tg;
}
function rockRadiusAt(y) {
    const above = y - HERO.footY;
    if (above <= 0) return HERO.radius;
    if (above >= HERO.height) return 0;
    return Math.max(0, HERO.radius * (1 - (above / HERO.height) ** (1 / HERO.exponent)));
}

console.log('== FLYBY GEOMETRY ==');
console.log(`  length      ${OLD_TOTAL.toFixed(2)} -> ${NEW_TOTAL.toFixed(2)}  (+${ADDED.toFixed(2)})`);
console.log(`  closest     ${minAxis.toFixed(1)} u from the massif AXIS at y ${minAxisY.toFixed(0)}  (was 442.7)`);
console.log(`  rock gap    ${(minAxis - rockRadiusAt(minAxisY)).toFixed(1)} u`);
console.log(`  ground clr  ${minClear.toFixed(1)} u   (baseline 46.3)`);
console.log(`  climb bank  ${climbMax.toFixed(2)} deg / 5.3u   (baseline 3.47)`);
console.log(`  ch6 guard   maxTurn ${mx.toFixed(2)} (<5.2), total ${tot.toFixed(1)} (<45), tangentY ${mty.toFixed(3)} (>0.1)`);

// ── the level re-map ────────────────────────────────────────────────────────────
// ids 1-28  : keep WORLD SEATS (nearest point on the new curve)
// ids 29-35 : re-spaced along the longer climb
// ids 36-59 : arc-preserving (all added length is before the boundary)
const ids = LEVEL_CONFIGS.map((l) => l.id).sort((a, b) => a - b);
const oldP = ODYSSEY_LAYOUT_DATA.levelPositionsById;
const newP = {};
let maxDrift = 0;
ids.forEach((id) => {
    const op = oldP[id];
    if (id <= 28) {
        const world = OLD_CURVE.getPointAt(op);
        const u = arcOf(NEW_CURVE, world, 12000);
        newP[id] = u;
        maxDrift = Math.max(maxDrift, NEW_CURVE.getPointAt(u).distanceTo(world));
    } else if (id >= 36) {
        newP[id] = (op * OLD_TOTAL + ADDED) / NEW_TOTAL;
    }
});
// 29-35 evenly between 28 and 36
const a = newP[28];
const b = newP[36];
for (let id = 29; id <= 35; id += 1) newP[id] = a + ((b - a) * (id - 28)) / 8;
newP[ids[ids.length - 1]] = 1;

console.log(`  world-seat drift for ids 1-28: max ${maxDrift.toFixed(3)} u`);
const mono = ids.every((id, i) => i === 0 || newP[id] > newP[ids[i - 1]]);
console.log(`  strictly increasing: ${mono}`);

if (process.argv.includes('--write')) {
    const file = 'src/core/odyssey/data/odyssey-layout.js';
    let src = fs.readFileSync(file, 'utf8');
    const ascentBlock = ASCENT.map((p) => `    Object.freeze({ x: ${p.x.toFixed(1)}, y: ${p.y.toFixed(1)}, z: ${p.z.toFixed(1)} }),`).join('\n');
    const tailBlock = [...TAIL, ...REST].map((p) => `    Object.freeze({ x: ${p.x.toFixed(1)}, y: ${p.y.toFixed(1)}, z: ${p.z.toFixed(1)} }),`).join('\n');
    // Replace everything from the first ascent point through the end of the array.
    const startMark = '    Object.freeze({ x: -186.4, y: 723.9, z: -581.4 }),';
    const endMark = '\n]);\n\nconst DEFAULT_LEVEL_POSITIONS_BY_ID';
    const i0 = src.indexOf(startMark);
    const i1 = src.indexOf(endMark);
    if (i0 < 0 || i1 < 0) throw new Error('anchors not found — layout file shape changed');
    src = src.slice(0, i0) + ascentBlock + '\n' + tailBlock + src.slice(i1);
    // Rewrite the level map.
    const mapBlock = ids.map((id) => `    ${id}: ${Number(newP[id].toFixed(4))},`).join('\n');
    src = src.replace(
        /const DEFAULT_LEVEL_POSITIONS_BY_ID = Object\.freeze\(\{[\s\S]*?\n\}\);/,
        `const DEFAULT_LEVEL_POSITIONS_BY_ID = Object.freeze({\n${mapBlock}\n});`,
    );
    fs.writeFileSync(file, src);
    console.log(`\nWROTE ${file}`);
    console.log(`  re-pin odyssey-path-layout.test.js arc length to ${NEW_TOTAL.toFixed(1)}`);
}

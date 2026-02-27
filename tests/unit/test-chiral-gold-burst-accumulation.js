import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Chiral Gold Burst Accumulation Wiring Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const themePath = path.join(__dirname, '..', '..', 'src', 'themes', 'chiral-gold', 'chiral-gold-theme.js');
const themeSource = fs.readFileSync(themePath, 'utf8');

console.log('Test 1: CPU burst path scans for idle pools instead of blind cycling');
assert(
    !themeSource.includes('const pool = this.burstPools[this.burstPoolIndex % this.burstPools.length]'),
    'triggerBurst should no longer use blind burstPoolIndex cycling for CPU pools',
);
console.log('  ✓ PASS');

console.log('\nTest 2: Idle-pool detection checks candidateState.active');
assert(
    themeSource.includes('!candidateState.active'),
    'triggerBurst should check candidateState.active to find idle pools',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Burst is skipped when no idle pool is available (accumulation guard)');
// Find the idle-pool scanning block and verify it returns early if no pool found
const scanBlock = themeSource.indexOf('Scan for an idle pool');
assert(scanBlock >= 0, 'Missing idle-pool scan comment');
const afterScan = themeSource.slice(scanBlock, scanBlock + 800);
assert(
    afterScan.includes('if (!pool) return'),
    'triggerBurst should return early when no idle pool is available',
);
console.log('  ✓ PASS');

console.log('\nTest 4: burstPoolIndex advances only when an idle pool is found');
assert(
    afterScan.includes('this.burstPoolIndex = (idx + 1) % this.burstPools.length'),
    'burstPoolIndex should advance inside the scan loop, not unconditionally',
);
console.log('  ✓ PASS');

console.log('\nAll Chiral Gold burst accumulation wiring checks passed.');

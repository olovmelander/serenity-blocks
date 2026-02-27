import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children Phase 0 Artifact Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const artDirectionPath = path.join(root, 'docs', 'SKY_CHILDREN_ART_DIRECTION.md');
const boardPath = path.join(root, 'docs', 'SKY_CHILDREN_PHASE0_REFERENCE_BOARD.md');
const lookLogPath = path.join(root, 'docs', 'SKY_CHILDREN_LOOK_LOG.md');

const artDirectionSource = fs.readFileSync(artDirectionPath, 'utf8');
const boardSource = fs.readFileSync(boardPath, 'utf8');
const lookLogSource = fs.readFileSync(lookLogPath, 'utf8');

console.log('Test 1: Look bible includes required Phase 0 gate and mood groups');
assert(artDirectionSource.includes('Sky Children Phase 0 Look Bible'), 'Missing look bible title');
assert(
    artDirectionSource.includes('12-20 curated Sky/Journey frames grouped by mood (sunset, cloud sea, interior haze)'),
    'Missing explicit Phase 0 frame requirement',
);
assert(artDirectionSource.includes('Sunset (primary)'), 'Missing Sunset mood bucket');
assert(artDirectionSource.includes('Cloud Sea'), 'Missing Cloud Sea mood bucket');
assert(artDirectionSource.includes('Interior Haze'), 'Missing Interior Haze mood bucket');
console.log('  ✓ PASS');

console.log('\nTest 2: Reference board contains 12-20 curated frame rows and all mood groups');
const frameRows = boardSource.match(/^\| SC-[A-Z]{3}-\d{2} \|/gm) || [];
assert(frameRows.length >= 12, `Expected >= 12 frame rows, found ${frameRows.length}`);
assert(frameRows.length <= 20, `Expected <= 20 frame rows, found ${frameRows.length}`);
assert(boardSource.includes('| SC-SUN-01 |'), 'Missing sunset frame entries');
assert(boardSource.includes('| SC-CLD-01 |'), 'Missing cloud sea frame entries');
assert(boardSource.includes('| SC-INT-01 |'), 'Missing interior haze frame entries');
assert(boardSource.includes('Sky'), 'Reference board should include Sky source references');
assert(boardSource.includes('Journey'), 'Reference board should include Journey source references');
console.log('  ✓ PASS');

console.log('\nTest 3: Look log template contains required regression tracking columns');
assert(lookLogSource.includes('Sky Children Look Log'), 'Missing look log title');
assert(
    lookLogSource.includes('| Date | Build/Branch | Shot ID | Drift Symptom |'),
    'Missing look log template columns',
);
assert(lookLogSource.includes('Corrective Diff'), 'Missing corrective diff column');
assert(lookLogSource.includes('Status Vocabulary'), 'Missing status vocabulary section');
console.log('  ✓ PASS');

console.log('\n=== All Sky Children Phase 0 Artifact Tests Passed ===');

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Nimbus Veil Phase 9 Art Direction Signoff Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-theme.js');
const source = fs.readFileSync(themePath, 'utf8');

console.log('Test 1: Phase D signoff thresholds and rubric helpers exist');
assert(source.includes('PHASED_SIGNOFF_THRESHOLDS'), 'Missing Phase D signoff threshold matrix');
assert(source.includes('computePhaseDCloudRubric({'), 'Missing Phase D rubric scoring helper');
assert(source.includes('findValidationCheck(summary, checkId)'), 'Missing shared validation-check lookup helper');
console.log('  ✓ PASS');

console.log('\nTest 2: Scenario matrix and signoff runner are implemented');
assert(source.includes('getPhaseDCloudSignoffScenarioPlan(options = {})'), 'Missing Phase D scenario-plan helper');
assert(source.includes('runPhaseDCloudSignoffScenario('), 'Missing Phase D scenario execution helper');
assert(source.includes('runPhaseDCloudSignoff(options = {})'), 'Missing Phase D signoff runner');
console.log('  ✓ PASS');

console.log('\nTest 3: Baseline API exposes Phase D report and download helpers');
assert(source.includes('phaseDCloudSignoff: (options = {}) => this.runPhaseDCloudSignoff(options),'), 'Baseline helper missing phaseDCloudSignoff');
assert(source.includes('phaseDCloudReport: () => this.getPhaseDCloudSignoffSummary(),'), 'Baseline helper missing phaseDCloudReport');
assert(source.includes('phaseDCloudDownload: (label) => this.downloadPhaseDCloudSignoffReport(label),'), 'Baseline helper missing phaseDCloudDownload');
assert(source.includes('getPhaseDCloudSignoffSummary()'), 'Missing Phase D summary getter');
assert(source.includes("downloadPhaseDCloudSignoffReport(label = 'nimbus-phaseD-cloud-signoff')"), 'Missing Phase D report download helper');
console.log('  ✓ PASS');

console.log('\n=== All Nimbus Veil Phase 9 Tests Passed ===');

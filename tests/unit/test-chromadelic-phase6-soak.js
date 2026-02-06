import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Chromadelic Phase 6 Soak Instrumentation Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const themePath = path.join(
    __dirname,
    '..',
    '..',
    'src',
    'themes',
    'chromadelic-highway',
    'chromadelic-highway-theme.js',
);
const themeSource = fs.readFileSync(themePath, 'utf8');

console.log('Test 1: Soak lifecycle control helpers exist');
assert(themeSource.includes('requestBaselineSoakStop()'), 'Missing requestBaselineSoakStop helper');
assert(themeSource.includes('clearBaselineSoakWait()'), 'Missing clearBaselineSoakWait helper');
assert(themeSource.includes('waitForBaselineSoakInterval(delayMs)'), 'Missing waitForBaselineSoakInterval helper');
console.log('  PASS');

console.log('\nTest 2: Long-session soak runner and trend summarization exist');
assert(themeSource.includes('summarizeSoakTrend(samples, key, fallbackIntervalMs = 30000)'), 'Missing summarizeSoakTrend helper');
assert(themeSource.includes('async runBaselineSoak(options = {})'), 'Missing runBaselineSoak helper');
assert(themeSource.includes('memoryTrendStable'), 'Missing memory trend stability evaluation');
assert(themeSource.includes('thermalTrendStable'), 'Missing thermal trend stability evaluation');
assert(themeSource.includes('this.lastBaselineSoakReport = soakReport;'), 'Soak report not stored');
console.log('  PASS');

console.log('\nTest 3: Baseline helper API exposes soak commands');
assert(themeSource.includes('runSoak: (options = {}) => this.runBaselineSoak(options)'), 'Missing runSoak helper exposure');
assert(themeSource.includes('getSoakReport: () => this.lastBaselineSoakReport'), 'Missing getSoakReport helper exposure');
assert(themeSource.includes('downloadSoakReport: (label) => this.downloadBaselineSoakReport(label)'), 'Missing downloadSoakReport helper exposure');
assert(themeSource.includes('stop: () => this.requestBaselineSoakStop()'), 'Stop helper does not abort soak');
console.log('  PASS');

console.log('\nTest 4: Theme lifecycle aborts active soak during teardown/recovery');
assert(themeSource.includes('this.requestBaselineSoakStop();'), 'Lifecycle does not request soak stop');
assert(themeSource.includes('this.baselineSoakAbortRequested = false;'), 'Soak abort flag is not reset for new scene');
console.log('  PASS');

console.log('\n=== Chromadelic Phase 6 Soak Instrumentation Tests Passed ===');

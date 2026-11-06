#!/usr/bin/env node
/**
 * High Coast field texture conversion: current implementation versus the one it
 * replaced on 2026-10-31. Run by hand, on the machine you care about:
 *
 *   npm run perf:high-coast:field -- [--size 1024] [--runs 9]
 *
 * Each side is warmed once, then timed in interleaved runs; the fastest run of
 * each is compared, so a single GC pause or scheduler stall cannot decide it.
 * Run directly in Node it measured about 6.4x on a cloud dev container. Inside
 * the Vitest suite the same comparison measured 2-2.7x there and only 1.1-1.25x
 * on GitHub's shared runners, so it is not a CI gate. The exit code is 1 when
 * the current code is no faster.
 */
import { performance } from 'node:perf_hooks';
import { fieldTextureData } from '../src/themes/high-coast/high-coast-field-data.js';
import { fieldTextureDataBefore, makeField } from './lib/high-coast-field-reference.mjs';

function option(name, fallback) {
    const index = process.argv.indexOf(`--${name}`);
    const value = index >= 0 ? Number(process.argv[index + 1]) : fallback;
    if (!Number.isInteger(value) || value < 2) throw new Error(`--${name} needs an integer of at least 2`);
    return value;
}

const size = option('size', 1024);
const runs = option('runs', 9);
const { field, heights, sky } = makeField(size, 9);
const once = (fn) => {
    const start = performance.now();
    fn(heights, sky, field);
    return performance.now() - start;
};

once(fieldTextureDataBefore);
once(fieldTextureData);
let before = Infinity;
let now = Infinity;
for (let run = 0; run < runs; run++) {
    before = Math.min(before, once(fieldTextureDataBefore));
    now = Math.min(now, once(fieldTextureData));
}

const speedup = before / now;
console.log(`High Coast field ${size}x${size}, fastest of ${runs} runs each:`);
console.log(`  before ${before.toFixed(1)} ms, now ${now.toFixed(1)} ms, ${speedup.toFixed(2)}x faster`);
if (speedup <= 1) {
    console.error('  The current conversion is no faster than the one it replaced.');
    process.exitCode = 1;
}

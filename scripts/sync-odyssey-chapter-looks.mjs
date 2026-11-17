#!/usr/bin/env node
/**
 * Write the chapter looks (src/core/odyssey/data/chapter-looks.js, the one table) into the
 * stylesheet that hands them to every Odyssey surface (public/styles/odyssey-shared.css):
 *   node scripts/sync-odyssey-chapter-looks.mjs          rewrites the generated block
 *   node scripts/sync-odyssey-chapter-looks.mjs --check  fails when the block is stale
 * tests/unit/odyssey-chapter-looks.test.js fails until the two agree.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderOdysseyChapterLookCss } from '../src/core/odyssey/data/chapter-looks.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHAPTER_LOOK_STYLESHEET = path.join(root, 'public', 'styles', 'odyssey-shared.css');
const BLOCK = /\/\* @odyssey-chapter-looks:start[\s\S]*?@odyssey-chapter-looks:end \*\//;

/** The generated block as the stylesheet holds it now, or null when it has none. */
export function readChapterLookBlock(source = readFileSync(CHAPTER_LOOK_STYLESHEET, 'utf8')) {
    const found = source.replace(/\r\n/g, '\n').match(BLOCK);
    return found ? found[0] : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const source = readFileSync(CHAPTER_LOOK_STYLESHEET, 'utf8').replace(/\r\n/g, '\n');
    const block = renderOdysseyChapterLookCss();
    if (!BLOCK.test(source)) {
        console.error('odyssey-shared.css has no @odyssey-chapter-looks block to rewrite');
        process.exit(1);
    }
    if (process.argv.includes('--check')) {
        if (readChapterLookBlock(source) !== block) {
            console.error('odyssey-shared.css is stale: run node scripts/sync-odyssey-chapter-looks.mjs');
            process.exit(1);
        }
        console.log('odyssey-shared.css chapter looks are up to date');
    } else {
        writeFileSync(CHAPTER_LOOK_STYLESHEET, source.replace(BLOCK, () => block));
        console.log('wrote the chapter looks into public/styles/odyssey-shared.css');
    }
}

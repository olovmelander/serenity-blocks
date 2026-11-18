/**
 * The menu's boot path, read from the source: every module src/main.js reaches through static
 * import/export-from statements (dynamic import() is the lazy path and is not followed).
 * scripts/check-boot-closure.mjs guards the built chunks, but it sees chunk names only, so a
 * module Rollup folds into a shared chunk main already loads never shows up there. Audit
 * 2026-11-18 A18-PERF-3: the Odyssey map input reached the whole return transition (portal gate,
 * journey ending, flow answers; ~54 KB minified) for one four-line predicate.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// vite.config.js resolve.alias
const ALIASES = [
    ['@core/', 'src/core/'], ['@rendering/', 'src/rendering/'], ['@themes/', 'src/themes/'],
    ['@ui/', 'src/ui/'], ['@utils/', 'src/utils/'], ['@events/', 'src/events/'], ['@/', 'src/'],
];
const STATIC_FROM = /^\s*(?:import|export)\b[^'"]*?\bfrom\s+['"]([^'"]+)['"]/gm;
const SIDE_EFFECT = /^\s*import\s+['"]([^'"]+)['"]/gm;

const isFile = (file) => existsSync(file) && statSync(file).isFile();

function resolveSpecifier(fromFile, specifier) {
    const bare = specifier.split('?')[0];
    const alias = ALIASES.find(([prefix]) => bare.startsWith(prefix));
    let target;
    if (alias) target = path.join(ROOT, alias[1], bare.slice(alias[0].length));
    else if (bare.startsWith('.')) target = path.resolve(path.dirname(fromFile), bare);
    else return null; // a package: three and phaser have their own chunk guard
    return [target, `${target}.js`, path.join(target, 'index.js')].find(isFile) ?? target;
}

function staticBootGraph(entry = 'src/main.js') {
    const start = path.join(ROOT, entry);
    const parent = new Map([[start, null]]);
    const unresolved = [];
    const queue = [start];
    while (queue.length) {
        const file = queue.shift();
        if (!/\.(m?js|ts)$/.test(file)) continue;
        const source = readFileSync(file, 'utf8');
        const specifiers = [...source.matchAll(STATIC_FROM), ...source.matchAll(SIDE_EFFECT)].map((m) => m[1]);
        for (const specifier of specifiers) {
            const target = resolveSpecifier(file, specifier);
            if (!target || parent.has(target)) continue;
            if (!isFile(target)) {
                unresolved.push(`${path.relative(ROOT, file)} → ${specifier}`);
                continue;
            }
            parent.set(target, file);
            queue.push(target);
        }
    }
    const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
    const chain = (file) => {
        const links = [];
        for (let at = file; at; at = parent.get(at)) links.unshift(rel(at));
        return links.join(' → ');
    };
    return { modules: [...parent.keys()].map(rel), chainTo: (module) => chain(path.join(ROOT, module)), unresolved };
}

describe('the menu boot path (src/main.js static imports)', () => {
    const graph = staticBootGraph();

    it('is read in full: every relative import resolves and the walk reaches the gamepad map input', () => {
        expect(graph.unresolved).toEqual([]);
        expect(graph.modules).toContain('src/ui/gamepad-controller.js');
        expect(graph.modules).toContain('src/ui/odyssey/odyssey-map-input.js');
    });

    it('does not load the Odyssey return transition or its portal gate before the menu', () => {
        const returnPassage = /^src\/rendering\/transitions\/(JourneyReturnTransition|portal-gate[^/]*)\.js$/;
        const reached = graph.modules.filter((module) => returnPassage.test(module)).map(graph.chainTo);
        expect(reached).toEqual([]);
    });
});

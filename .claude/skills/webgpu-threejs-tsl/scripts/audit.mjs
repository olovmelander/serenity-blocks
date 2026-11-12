#!/usr/bin/env node
/**
 * Audit of this skill against the installed three and the repo it lives in.
 *
 *   node .claude/skills/webgpu-threejs-tsl/scripts/audit.mjs
 *
 * A reference that drifts from the code it describes is worse than none: an agent trusts it.
 * This checks what can be checked by machine, so the rest of the skill may be trusted:
 *
 *   stamp     the version the skill says it was verified against is the one installed and pinned
 *   size      SKILL.md stays small enough to load whole on every use
 *   api       every name the skill imports from three/tsl, three/webgpu or three/addons exists
 *             in the installed package, and every THREE.<Name> it writes
 *   gotchas   every row is one line of four cells with a unique id from the right block, every
 *             topic file is listed, and every "#NN" cited anywhere names a row that exists
 *   paths     every repo file the skill points at exists
 *
 * "Hard" findings fail tests/unit/agent-skill-contract.test.js (and this script's exit code).
 * "Soft" findings are the precedent files named in gotcha rows and reference docs: a theme may
 * be rebuilt without touching the skill, so they are reported here, not failed in CI. Run this
 * script after a rebuild that deletes files, and at every three bump (ADR-0018).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(SKILL_DIR, '..', '..', '..');

/** SKILL.md is loaded whole every time the skill is used: these keep it a map, not a manual. */
export const SKILL_BUDGET = Object.freeze({ lines: 260, bytes: 20 * 1024, tableRowChars: 400 });

/** The files that route a reader: a path they cite must exist. */
const ROUTING_FILES = [/^SKILL[.]md$/, /^docs\/theme-foundation[.]md$/, /^docs\/three-r\d+[.]md$/, /^gotchas\/README[.]md$/];

const BS = String.fromCharCode(92);
const posix = (p) => p.split(path.sep).join('/');
const read = (rel) => readFileSync(path.join(SKILL_DIR, rel), 'utf8');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

function walk(dir, keep, out = [], base = dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(absolute, keep, out, base);
        else if (keep(entry.name)) out.push(posix(path.relative(base, absolute)));
    }
    return out;
}

/** Every text file of the skill except this script (its own patterns are not claims). */
export function skillFiles() {
    return walk(SKILL_DIR, (name) => /[.](md|js|mjs)$/.test(name)).filter((f) => !f.startsWith('scripts/')).sort();
}

// ---- stamp -------------------------------------------------------------------------------------

export function auditStamp() {
    const problems = [];
    const installed = JSON.parse(readFileSync(path.join(REPO_ROOT, 'node_modules/three/package.json'), 'utf8')).version;
    const pinned = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).dependencies?.three;
    const revision = `r${installed.split('.')[1]}`;
    if (pinned !== installed) problems.push(`package.json pins three "${pinned}" but ${installed} is installed (ADR-0018: an exact pin)`);
    const skill = read('SKILL.md');
    const description = /^description:(.*)$/m.exec(skill)?.[1] ?? '';
    if (!description.includes(installed) || !description.includes(revision)) {
        problems.push(`SKILL.md's description must name the installed three "${installed}" and "${revision}": re-verify the skill (run this script) and re-stamp it in the bump commit`);
    }
    const notes = readdirSync(path.join(SKILL_DIR, 'docs')).filter((f) => /^three-r\d+[.]md$/.test(f));
    if (notes.length !== 1 || notes[0] !== `three-${revision}.md`) {
        problems.push(`docs/ must hold exactly one version file, docs/three-${revision}.md (found: ${notes.join(', ') || 'none'})`);
    }
    if (!skill.includes(`docs/three-${revision}.md`)) problems.push(`SKILL.md must point at docs/three-${revision}.md`);
    return { installed, pinned, revision, problems };
}

// ---- size --------------------------------------------------------------------------------------

export function auditSize() {
    const problems = [];
    const skill = read('SKILL.md');
    const lines = skill.split('\n');
    const bytes = Buffer.byteLength(skill);
    if (lines.length > SKILL_BUDGET.lines) problems.push(`SKILL.md is ${lines.length} lines (budget ${SKILL_BUDGET.lines}): move detail into docs/ or gotchas/`);
    if (bytes > SKILL_BUDGET.bytes) problems.push(`SKILL.md is ${bytes} bytes (budget ${SKILL_BUDGET.bytes}): move detail into docs/ or gotchas/`);
    lines.forEach((line, i) => {
        if (line.startsWith('|') && line.length > SKILL_BUDGET.tableRowChars) {
            problems.push(`SKILL.md:${i + 1} is a ${line.length}-character table row: a gotcha row belongs in gotchas/<topic>.md (see gotchas/README.md)`);
        }
    });
    return { lines: lines.length, bytes, problems };
}

// ---- api ---------------------------------------------------------------------------------------

export async function auditApi() {
    const problems = [];
    const load = (file) => import(pathToFileURL(path.join(REPO_ROOT, 'node_modules/three/build', file)).href);
    const tsl = new Set(Object.keys(await load('three.tsl.js')));
    const webgpu = new Set(Object.keys(await load('three.webgpu.js')));
    const addonRoot = path.join(REPO_ROOT, 'node_modules/three/examples/jsm');
    const identifier = /^[A-Za-z_$][\w$]*$/;
    let checked = 0;

    for (const file of skillFiles()) {
        const text = read(file);
        for (const match of text.matchAll(/import\s*[{]([^}]*)[}]\s*from\s*['"]([^'"]+)['"]/g)) {
            // Comments inside an import list are prose, not names.
            const list = match[1].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
            const names = list.split(',').map((part) => part.trim().split(/\s+as\s+/)[0].trim()).filter((name) => identifier.test(name));
            const from = match[2];
            const where = `${file}:${lineOf(text, match.index)}`;
            if (from === 'three/tsl' || from === 'three/webgpu') {
                const exported = from === 'three/tsl' ? tsl : webgpu;
                for (const name of names) {
                    checked++;
                    if (!exported.has(name)) problems.push(`${where} imports "${name}" from ${from}, which does not export it`);
                }
            } else if (from.startsWith('three/addons/')) {
                const addon = path.join(addonRoot, from.slice('three/addons/'.length));
                if (!existsSync(addon)) { problems.push(`${where} imports from ${from}, which does not exist`); continue; }
                const source = readFileSync(addon, 'utf8');
                for (const name of names) {
                    checked++;
                    const declared = new RegExp(`export\\s+(?:default\\s+)?(?:const|let|var|function\\*?|class|async function)\\s+${name}\\b|export\\s*[{][^}]*\\b${name}\\b[^}]*[}]`);
                    if (!declared.test(source)) problems.push(`${where} imports "${name}" from ${from}, which does not export it`);
                }
            } else if (from === 'three') {
                problems.push(`${where} imports from 'three': WebGPU work imports 'three/webgpu' (a second copy of three breaks node materials)`);
            }
        }
        for (const match of text.matchAll(/['"`](three\/addons\/[\w./-]+[.]js)['"`]/g)) {
            checked++;
            if (!existsSync(path.join(addonRoot, match[1].slice('three/addons/'.length)))) {
                problems.push(`${file}:${lineOf(text, match.index)} names ${match[1]}, which does not exist`);
            }
        }
        for (const match of text.matchAll(/\bTHREE[.]([A-Za-z_]\w*)/g)) {
            checked++;
            if (!webgpu.has(match[1])) problems.push(`${file}:${lineOf(text, match.index)} writes THREE.${match[1]}, which three/webgpu does not export`);
        }
    }
    return { checked, problems: [...new Set(problems)] };
}

// ---- gotchas -----------------------------------------------------------------------------------

/** A table row's cells, honouring `\|` (a pipe inside a cell). */
export function cellsOf(line) {
    const cells = [];
    let cell = '';
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '|' && line[i - 1] !== BS) { cells.push(cell); cell = ''; } else cell += line[i];
    }
    cells.push(cell);
    return cells.slice(1, -1).map((c) => c.trim());
}

export function auditGotchas() {
    const problems = [];
    const dir = path.join(SKILL_DIR, 'gotchas');
    const topicFiles = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();

    // The blocks are declared once, in gotchas/README.md.
    const blocks = new Map();
    for (const match of read('gotchas/README.md').matchAll(/^[|] `([\w-]+[.]md)` [|] (\d+)[–-](\d+) [|]$/gm)) {
        blocks.set(match[1], [Number(match[2]), Number(match[3])]);
    }
    const skill = read('SKILL.md');
    for (const file of topicFiles) {
        if (!blocks.has(file)) problems.push(`gotchas/${file} has no block in gotchas/README.md`);
        if (!skill.includes(`\`${file}\``)) problems.push(`gotchas/${file} is not listed in SKILL.md's table of gotcha files`);
    }
    for (const file of blocks.keys()) if (!topicFiles.includes(file)) problems.push(`gotchas/README.md gives a block to ${file}, which does not exist`);
    const ranges = [...blocks.entries()].sort((a, b) => a[1][0] - b[1][0]);
    ranges.forEach(([file, [from, to]], i) => {
        if (from < 300 || to <= from) problems.push(`gotchas/README.md: ${file}'s block ${from}–${to} must start at 300 or above`);
        if (i > 0 && from <= ranges[i - 1][1][1]) problems.push(`gotchas/README.md: the blocks of ${ranges[i - 1][0]} and ${file} overlap`);
    });

    const rows = [];
    const seen = new Map();
    for (const file of topicFiles) {
        const lines = read(`gotchas/${file}`).split('\n');
        if (!lines.includes('| # | Symptom | Cause | Fix |')) problems.push(`gotchas/${file} has no "| # | Symptom | Cause | Fix |" table`);
        // Only THE gotcha table is held to the row format; a file may carry other small tables.
        let inTable = false;
        lines.forEach((line, i) => {
            if (line === '| # | Symptom | Cause | Fix |') { inTable = true; return; }
            if (!line.startsWith('|')) { inTable = false; return; }
            if (!inTable || /^[|][-| ]+[|]$/.test(line)) return;
            const where = `gotchas/${file}:${i + 1}`;
            const cells = cellsOf(line);
            const id = /^#(\d+)$/.exec(cells[0] ?? '');
            if (!id) { problems.push(`${where} is a table row without an id: start it "| #<number> |" (gotchas/README.md)`); return; }
            if (cells.length !== 4) problems.push(`${where} (#${id[1]}) has ${cells.length} cells, not 4: escape a pipe inside a cell as ${BS}|`);
            if (cells.some((cell) => cell === '')) problems.push(`${where} (#${id[1]}) has an empty cell: write "—" when there is no cause to give`);
            const number = Number(id[1]);
            if (seen.has(number)) problems.push(`#${number} is the id of two rows, ${seen.get(number)} and ${where}: give the newer one the next free number in its file's block`);
            seen.set(number, where);
            const block = blocks.get(file);
            if (number >= 300 && block && (number < block[0] || number > block[1])) {
                problems.push(`${where} (#${number}) is outside ${file}'s block ${block[0]}–${block[1]}`);
            }
            rows.push({ id: number, file, line: i + 1, symptom: cells[1] ?? '' });
        });
    }

    // Every "#NN" cited in the skill names a row. Larger numbers are upstream issue numbers.
    const dangling = [];
    for (const file of skillFiles()) {
        if (!file.endsWith('.md')) continue;
        const text = read(file);
        // "#10-tests-and-gates" is a heading anchor, not a citation.
        for (const match of text.matchAll(/(?<![\w&`/])#(\d{2,4})(?![\w]|-[a-z])/g)) {
            const number = Number(match[1]);
            if (number < 2000 && !seen.has(number)) dangling.push(`${file}:${lineOf(text, match.index)} cites #${number}, which is no row in gotchas/`);
        }
    }
    problems.push(...dangling);
    return { files: topicFiles.length, rows, problems };
}

// ---- paths -------------------------------------------------------------------------------------

export function auditPaths() {
    const hard = [];
    const soft = [];
    const repoFiles = ['src', 'tests', 'scripts'].flatMap((top) => walk(path.join(REPO_ROOT, top), () => true, [], REPO_ROOT));
    const threeFiles = ['src', 'examples/jsm', 'build'].flatMap((top) => walk(path.join(REPO_ROOT, 'node_modules/three', top), () => true, [], path.join(REPO_ROOT, 'node_modules/three')));
    const endsWith = (list, token) => list.some((f) => f === token || f.endsWith(`/${token}`));
    const inRepo = (token) => existsSync(path.join(REPO_ROOT, token));
    const inSkill = (token) => existsSync(path.join(SKILL_DIR, token));
    const rooted = /^(src|tests|scripts|public|docs|gotchas|templates|[.]claude|[.]agents|node_modules\/three)\//;
    const extension = /[.](js|mjs|cjs|ts|md|json|css|html|png|glb)$/;
    let checked = 0;

    for (const file of skillFiles()) {
        if (!file.endsWith('.md')) continue;
        const routing = ROUTING_FILES.some((pattern) => pattern.test(file));
        read(file).split('\n').forEach((line, i) => {
            for (const match of line.matchAll(/`([^`\s]+)`/g)) {
                let token = match[1].replace(/:[\d-]+$/, '').replace(/^[.]\//, '');
                if (/[<>*…$(){}=,]|NEW_ID/.test(token) || !/^[\w@.\-/]+$/.test(token)) continue;
                const where = `${file}:${i + 1}`;
                if (rooted.test(token)) {
                    if (!extension.test(token) && !token.endsWith('/')) continue; // a prefix such as tests/unit/odyssey-
                    // docs/, gotchas/, templates/ and scripts/ are this skill's own folders first,
                    // the repo's second.
                    const own = /^(docs|gotchas|templates|scripts)\//.test(token);
                    token = token.replace(/\/$/, '');
                    checked++;
                    const found = inRepo(token) || (own && inSkill(token));
                    if (!found) (routing ? hard : soft).push(`${where} points at ${token}, which does not exist`);
                } else if (token.startsWith('three/addons/')) {
                    continue; // checked with the API names, against examples/jsm
                } else if (/^[\w@.]/.test(token) && /[.](js|mjs)$/.test(token) && (token.includes('/') || token.includes('-'))) {
                    // A bare or partial file name, as gotcha rows write precedents.
                    checked++;
                    if (!endsWith(repoFiles, token) && !endsWith(threeFiles, token)) soft.push(`${where} names ${token}, and no file in src/, tests/, scripts/ or three ends with that`);
                }
            }
        });
    }
    return { checked, hard: [...new Set(hard)], soft: [...new Set(soft)] };
}

// ---- all ---------------------------------------------------------------------------------------

export async function audit() {
    const stamp = auditStamp();
    const size = auditSize();
    const api = await auditApi();
    const gotchas = auditGotchas();
    const paths = auditPaths();
    const hard = [...stamp.problems, ...size.problems, ...api.problems, ...gotchas.problems, ...paths.hard];
    return { stamp, size, api, gotchas, paths, hard, soft: paths.soft };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = await audit();
    console.log(`webgpu-threejs-tsl skill audit (${posix(path.relative(REPO_ROOT, SKILL_DIR))})`);
    console.log(`  three ${result.stamp.installed} (${result.stamp.revision}), pinned "${result.stamp.pinned}"`);
    console.log(`  SKILL.md ${result.size.lines} lines, ${result.size.bytes} bytes (budget ${SKILL_BUDGET.lines} / ${SKILL_BUDGET.bytes})`);
    console.log(`  ${result.api.checked} API names checked against the installed package`);
    console.log(`  ${result.gotchas.rows.length} gotcha rows in ${result.gotchas.files} files`);
    console.log(`  ${result.paths.checked} cited paths checked`);
    const section = (title, list) => { if (list.length) { console.log(`\n${title} (${list.length})`); for (const item of list) console.log(`  - ${item}`); } };
    section('HARD: the contract test fails on these', result.hard);
    section('SOFT: precedents to repoint or mark as removed', result.soft);
    if (!result.hard.length && !result.soft.length) console.log('\nclean');
    process.exitCode = result.hard.length ? 1 : 0;
}

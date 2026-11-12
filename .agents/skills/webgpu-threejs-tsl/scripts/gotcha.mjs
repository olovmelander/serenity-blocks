#!/usr/bin/env node
/**
 * Find gotchas by number or by words, and print each as symptom / cause / fix.
 *
 *   node .claude/skills/webgpu-threejs-tsl/scripts/gotcha.mjs 94              the row #94
 *   node .claude/skills/webgpu-threejs-tsl/scripts/gotcha.mjs "vertex buffer"  rows holding that phrase
 *   node .claude/skills/webgpu-threejs-tsl/scripts/gotcha.mjs black bloom      rows holding BOTH words
 *   node .claude/skills/webgpu-threejs-tsl/scripts/gotcha.mjs --list           every row: number + symptom, by file
 *   node .claude/skills/webgpu-threejs-tsl/scripts/gotcha.mjs --list water     the same for files named *water*
 *
 * Why a script: a row is one line of 600 to 1,600 characters, which keeps it whole under any
 * search, but a search tool that clips long lines shows "[Omitted long matching line]" instead.
 * This prints the row in full, split into its three cells. Matching is case-insensitive, on the
 * row's text; several arguments must all match.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'gotchas');
const BS = String.fromCharCode(92);

function cellsOf(line) {
    const cells = [];
    let cell = '';
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '|' && line[i - 1] !== BS) { cells.push(cell); cell = ''; } else cell += line[i];
    }
    cells.push(cell);
    return cells.slice(1, -1).map((c) => c.trim().split(`${BS}|`).join('|'));
}

const rows = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()) {
    for (const line of readFileSync(path.join(dir, file), 'utf8').split('\n')) {
        const id = /^[|] #(\d+) [|]/.exec(line);
        if (!id) continue;
        const [, symptom = '', cause = '', fix = ''] = cellsOf(line);
        rows.push({ id: Number(id[1]), file, symptom, cause, fix, text: line.toLowerCase() });
    }
}

const args = process.argv.slice(2);
const wrap = (label, text) => {
    const words = text.split(/\s+/);
    const lines = [];
    let current = '';
    for (const word of words) {
        if (current && current.length + word.length + 1 > 96) { lines.push(current); current = word; } else current = current ? `${current} ${word}` : word;
    }
    if (current) lines.push(current);
    return lines.map((line, i) => `  ${i === 0 ? label : ' '.repeat(label.length)} ${line}`).join('\n');
};
const show = (row) => `#${row.id}  gotchas/${row.file}\n${wrap('Symptom', row.symptom)}\n${wrap('Cause  ', row.cause)}\n${wrap('Fix    ', row.fix)}\n`;

if (!args.length) {
    console.log('usage: gotcha.mjs <number> | <words…> | --list [file]\n');
    const byFile = new Map();
    for (const row of rows) byFile.set(row.file, (byFile.get(row.file) ?? 0) + 1);
    for (const [file, count] of byFile) console.log(`  ${String(count).padStart(3)} rows  gotchas/${file}`);
    console.log(`\n  ${rows.length} rows in all`);
} else if (args[0] === '--list') {
    const only = (args[1] ?? '').toLowerCase();
    let file = '';
    for (const row of rows.filter((r) => r.file.includes(only))) {
        if (row.file !== file) { file = row.file; console.log(`\ngotchas/${file}`); }
        console.log(`  #${String(row.id).padEnd(5)} ${row.symptom.slice(0, 118)}${row.symptom.length > 118 ? '…' : ''}`);
    }
} else {
    const number = args.length === 1 ? /^#?(\d+)$/.exec(args[0]) : null;
    const found = number
        ? rows.filter((row) => row.id === Number(number[1]))
        : rows.filter((row) => args.every((arg) => row.text.includes(arg.toLowerCase())));
    if (!found.length) {
        console.log(`no gotcha ${number ? `#${number[1]}` : `holds ${args.map((a) => `"${a}"`).join(' and ')}`}. Try fewer or other words, or --list.`);
        process.exitCode = 1;
    } else {
        console.log(found.map(show).join('\n'));
        if (found.length > 1) console.log(`${found.length} rows`);
    }
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Tripwire: electron/preload.cjs (shipped — electron/main.js loads it) and
// electron/preload.mjs (loaded by the validate:windows:* harnesses) are twins
// and MUST expose the same surface. They once drifted: preload.mjs lacked
// electronAPI.diagnosticsEnabled, so the validation harnesses exercised a
// renderer where that flag was undefined while production had it. This test
// compares the channel whitelists and every exposeInMainWorld key set so any
// future one-sided edit fails CI.

const __dirname = dirname(fileURLToPath(import.meta.url));
const cjsSource = readFileSync(join(__dirname, '../../electron/preload.cjs'), 'utf8');
const mjsSource = readFileSync(join(__dirname, '../../electron/preload.mjs'), 'utf8');

function extractSetLiteral(source, name) {
    const match = source.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
    expect(match, `${name} Set literal not found`).toBeTruthy();
    // Strip // comments first so an apostrophe in a comment can't corrupt the
    // quoted-string scan.
    const body = match[1].replace(/\/\/[^\n]*/g, '');
    const channels = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    // Guard against the parser going vacuous: [] === [] would pass silently.
    expect(channels.length, `${name} parsed as empty — parser or source drifted`).toBeGreaterThan(0);
    return channels;
}

function extractExposedKeys(source, surface) {
    const start = source.indexOf(`contextBridge.exposeInMainWorld('${surface}', {`);
    expect(start, `${surface} surface not found`).toBeGreaterThanOrEqual(0);
    const open = source.indexOf('{', start);
    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') depth -= 1;
        if (depth === 0) { end = i; break; }
    }
    const body = source.slice(open + 1, end);
    // Top-level keys only: 4-space-indented `name:` or shorthand `name,`
    // (both files share this formatting).
    const keys = [...body.matchAll(/^ {4}(\w+)[,:]/gm)].map((m) => m[1]).sort();
    // Guard against the parser going vacuous if the formatting assumption
    // breaks in BOTH files at once ([] === [] would pass silently).
    expect(keys.length, `${surface} parsed as empty — indent assumption broke`).toBeGreaterThan(3);
    return keys;
}

// Sentinel keys: if the parser ever mis-parses both files symmetrically, these
// pins still fail loudly.
const REQUIRED_ELECTRON_API_KEYS = ['diagnosticsEnabled', 'getGPUHealth', 'openDevTools', 'onRuntimeEvent'];

describe('preload.cjs / preload.mjs parity', () => {
    it('whitelists identical invoke channels', () => {
        expect(extractSetLiteral(mjsSource, 'allowedInvokeChannels'))
            .toEqual(extractSetLiteral(cjsSource, 'allowedInvokeChannels'));
    });

    it('whitelists identical event channels', () => {
        expect(extractSetLiteral(mjsSource, 'allowedEventChannels'))
            .toEqual(extractSetLiteral(cjsSource, 'allowedEventChannels'));
    });

    it.each(['electronAPI', 'electronDisplay', 'steamworks'])(
        'exposes identical %s keys',
        (surface) => {
            expect(extractExposedKeys(mjsSource, surface))
                .toEqual(extractExposedKeys(cjsSource, surface));
        },
    );

    it('exposes the load-bearing electronAPI keys in both files', () => {
        for (const source of [cjsSource, mjsSource]) {
            const keys = extractExposedKeys(source, 'electronAPI');
            for (const required of REQUIRED_ELECTRON_API_KEYS) {
                expect(keys, `missing electronAPI.${required}`).toContain(required);
            }
        }
    });
});

/**
 * The IP-string gate over a packaged desktop build (legal review v4.0, P0.7, which names "the
 * Electron package" next to dist/): the app.asar that electron-builder writes and the files it
 * places beside it.
 *
 * Shared by scripts/ip-string-gate.mjs (every package under release/, when one is there) and
 * scripts/afterPack.cjs (every build, as it is packaged, so a store build cannot skip it).
 *
 * The rules are dist/'s: the genre mark (class A), names from other franchises' worlds (class B)
 * and the blocked names (class C), in the text of every text file and in every file name. The one
 * allowance is the legal notice, which names the mark: CREDITS.md inside the package (the dist/
 * copy the gate already allows) and beside it. Third-party
 * packages copied beside the package (resources/native_modules/) are not this project's to rename
 * and are not scanned.
 */
import fs from 'node:fs';
import path from 'node:path';
import asar from '@electron/asar';
import { BLOCKED_TOKENS, GENRE_TOKEN, WORLD_TOKEN, findToken } from './ip-tokens.mjs';

const TEXT_EXT = /\.(js|mjs|cjs|css|html|svg|json|txt|md|xml|webmanifest)$/i;
const ALLOWED_IN_ASAR = new Set(['dist/CREDITS.md']);
const ALLOWED_BESIDE = new Set(['CREDITS.md']);

/** @type {Array<{ id: string, re: RegExp }>} */
const SHIPPED_TOKENS = [
    { id: 'genre mark', re: GENRE_TOKEN },
    { id: 'world name', re: WORLD_TOKEN },
    ...BLOCKED_TOKENS,
];

function scanEntry(label, name, text) {
    const violations = [];
    for (const token of SHIPPED_TOKENS) {
        for (const hit of findToken(token, name)) {
            violations.push(`${label} (file name): ${token.id} …${hit.context}…`);
        }
        if (text === null) continue;
        for (const hit of findToken(token, text)) {
            violations.push(`${label}:${hit.line}: ${token.id} …${hit.context}…`);
        }
    }
    return violations;
}

/** Every file in an asar header, as forward-slash paths relative to the archive root. */
function* asarFiles(node, prefix = '') {
    for (const [name, child] of Object.entries(node.files ?? {})) {
        const rel = prefix ? `${prefix}/${name}` : name;
        if ('files' in child) yield* asarFiles(child, rel);
        else if (!('link' in child)) yield rel;
    }
}

/**
 * Every directory under `root` that holds an app.asar: resources/ on Windows and Linux,
 * Contents/Resources/ inside the .app on macOS. A missing `root` gives none.
 * @param {string} root
 * @param {number} [maxDepth]
 * @returns {string[]}
 */
export function findPackagedResources(root, maxDepth = 4) {
    const found = [];
    const visit = (dir, depth) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        if (entries.some((entry) => entry.isFile() && entry.name === 'app.asar')) {
            found.push(dir);
            return;
        }
        if (depth >= maxDepth) return;
        for (const entry of entries) {
            if (entry.isDirectory()) visit(path.join(dir, entry.name), depth + 1);
        }
    };
    visit(root, 0);
    return found;
}

/**
 * Scan one packaged build: every file inside its app.asar and the files beside it.
 * @param {string} resourcesDir  the directory that holds app.asar
 * @returns {{ violations: string[], fileCount: number }}
 */
export function scanPackagedApp(resourcesDir) {
    const archive = path.join(resourcesDir, 'app.asar');
    const violations = [];
    let fileCount = 0;

    for (const rel of asarFiles(asar.getRawHeader(archive).header)) {
        fileCount++;
        if (ALLOWED_IN_ASAR.has(rel)) continue;
        // @electron/asar splits paths on the platform separator.
        const text = TEXT_EXT.test(rel)
            ? asar.extractFile(archive, rel.split('/').join(path.sep)).toString('utf8')
            : null;
        violations.push(...scanEntry(`app.asar/${rel}`, rel, text));
    }

    for (const entry of fs.readdirSync(resourcesDir, { withFileTypes: true })) {
        // app.asar is scanned above; any other .asar is Electron's own.
        if (!entry.isFile() || entry.name.endsWith('.asar')) continue;
        fileCount++;
        if (ALLOWED_BESIDE.has(entry.name)) continue;
        const text = TEXT_EXT.test(entry.name)
            ? fs.readFileSync(path.join(resourcesDir, entry.name), 'utf8')
            : null;
        violations.push(...scanEntry(entry.name, entry.name, text));
    }

    asar.uncache(archive);
    return { violations, fileCount };
}

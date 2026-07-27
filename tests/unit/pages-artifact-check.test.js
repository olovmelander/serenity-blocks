import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
);
const checkerPath = path.join(repoRoot, 'scripts', 'pages-artifact-check.mjs');
const temporaryArtifactRoots = [];

function createArtifact() {
    const artifactRoot = mkdtempSync(path.join(tmpdir(), 'serenity-pages-artifact-'));
    const assetsDir = path.join(artifactRoot, 'assets');
    temporaryArtifactRoots.push(artifactRoot);
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(
        path.join(artifactRoot, 'manifest.json'),
        JSON.stringify({
            'src/entry-desktop.js': {
                file: 'assets/entry.js',
            },
        }),
    );
    writeFileSync(path.join(assetsDir, 'entry.js'), 'export const ready = true;\n');
    copyFileSync(
        path.join(repoRoot, 'CREDITS.md'),
        path.join(artifactRoot, 'CREDITS.md'),
    );
    copyFileSync(
        path.join(repoRoot, 'README.md'),
        path.join(artifactRoot, 'README.md'),
    );
    return artifactRoot;
}

function runChecker(artifactRoot) {
    return spawnSync(
        process.execPath,
        [checkerPath, '--dist-dir', artifactRoot],
        {
            cwd: repoRoot,
            encoding: 'utf8',
        },
    );
}

describe('pages artifact checker', () => {
    afterEach(() => {
        while (temporaryArtifactRoots.length > 0) {
            rmSync(temporaryArtifactRoots.pop(), {
                recursive: true,
                force: true,
            });
        }
    });

    it('accepts a custom artifact root and rejects a stale legal notice', () => {
        const artifactRoot = createArtifact();

        const valid = runChecker(artifactRoot);
        expect(valid.status).toBe(0);
        expect(valid.stdout).toContain('pages-artifact-check: OK');

        writeFileSync(
            path.join(artifactRoot, 'README.md'),
            'stale artifact notice\n',
        );

        const stale = runChecker(artifactRoot);
        expect(stale.status).toBe(1);
        expect(stale.stderr).toContain(
            'README.md differs byte-for-byte from the repository-root README.md.',
        );
    });
});

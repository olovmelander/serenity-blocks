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

// THIRD_PARTY_LICENSES.md as Vite's build.license writes it; a null text leaves that entry bare.
function bundledLicenses(phaserText, threeText) {
    return [
        '# Licenses',
        '## phaser - 4.2.1 (MIT)',
        phaserText,
        '## three - 0.186.1 (MIT)',
        threeText,
    ].filter((line) => line !== null).join('\n\n') + '\n';
}

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
    writeFileSync(
        path.join(artifactRoot, 'THIRD_PARTY_LICENSES.md'),
        bundledLicenses('MIT License', 'The MIT License'),
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

    it('rejects an artifact whose bundled-library licenses are missing or empty', () => {
        const artifactRoot = createArtifact();
        const licensesPath = path.join(artifactRoot, 'THIRD_PARTY_LICENSES.md');

        writeFileSync(licensesPath, bundledLicenses('MIT License', null));
        const textless = runChecker(artifactRoot);
        expect(textless.status).toBe(1);
        expect(textless.stderr).toContain('THIRD_PARTY_LICENSES.md has no license text for three.');
        expect(textless.stderr).not.toContain('for phaser');

        rmSync(licensesPath);
        const missing = runChecker(artifactRoot);
        expect(missing.status).toBe(1);
        expect(missing.stderr).toContain('THIRD_PARTY_LICENSES.md is missing');
    });
});

import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture(prefix = 'serenity-boot-') {
    const root = mkdtempSync(path.join(tmpdir(), prefix));
    roots.push(root);
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'dist', 'assets'), { recursive: true });
    copyFileSync(new URL('../../scripts/check-boot-closure.mjs', import.meta.url), path.join(root, 'scripts/check-boot-closure.mjs'));
    const manifest = {
        'src/entry-desktop.js': { file: 'assets/entry-12345678.js' },
        'src/main.js': { file: 'assets/main-12345678.js', imports: [] },
    };
    for (const record of Object.values(manifest)) writeFileSync(path.join(root, 'dist', record.file), 'export {};');
    return {
        root,
        manifest,
        run() {
            writeFileSync(path.join(root, 'dist/manifest.json'), JSON.stringify(manifest));
            return spawnSync(process.execPath, [path.join(root, 'scripts/check-boot-closure.mjs')], { encoding: 'utf8' });
        },
    };
}

describe('boot closure CLI', () => {
    it('works from a checkout path containing spaces and Unicode', () => {
        const result = fixture('serenity boot å-').run();
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('boot closure OK');
    });

    it('rejects a missing chunk instead of counting it as zero bytes', () => {
        const project = fixture();
        rmSync(path.join(project.root, 'dist/assets/main-12345678.js'));
        const result = project.run();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('main-12345678.js');
    });

    it('rejects a dangling static import in the manifest', () => {
        const project = fixture();
        project.manifest['src/main.js'].imports.push('_missing.js');
        const result = project.run();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('_missing.js');
    });

    it('continues to reject a lazy renderer imported by the boot path', () => {
        const project = fixture();
        project.manifest._three = { file: 'assets/three-12345678.js' };
        project.manifest['src/main.js'].imports.push('_three');
        writeFileSync(path.join(project.root, 'dist/assets/three-12345678.js'), 'export {};');
        const result = project.run();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('main statically reaches lazy chunk three');
    });
});

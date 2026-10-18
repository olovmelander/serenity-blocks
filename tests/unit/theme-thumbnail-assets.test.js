import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { buildThemeThumbnailAssetEntries } from '../../scripts/theme-thumbnail-assets.js';

const temporaryRoots = [];

function createTempProjectRoot() {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'serenity-theme-thumbnails-'));
    temporaryRoots.push(projectRoot);
    return projectRoot;
}

function writeThemeIcon(projectRoot, relativePath, contents) {
    const absolutePath = path.join(projectRoot, 'src', 'themes', relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents);
    return absolutePath;
}

afterEach(() => {
    temporaryRoots.splice(0).forEach((projectRoot) => {
        rmSync(projectRoot, { recursive: true, force: true });
    });
});

describe('buildThemeThumbnailAssetEntries', () => {
    it('emits theme-id based thumbnail assets and preserves alias icon sources', () => {
        const projectRoot = createTempProjectRoot();
        const forestIcon = writeThemeIcon(projectRoot, 'forest/forest-theme-icon.png', 'forest');
        const exampleV2Icon = writeThemeIcon(
            projectRoot,
            'example-v2/example-theme-icon.png',
            'example-v2',
        );

        const entries = buildThemeThumbnailAssetEntries({
            projectRoot,
            themeRegistry: [
                { id: 'forest', icon: './forest/forest-theme-icon.png' },
                { id: 'example', icon: './example-v2/example-theme-icon.png' },
                { id: 'example-v2', icon: './example-v2/example-theme-icon.png' },
            ],
        });
        const entriesByFileName = new Map(entries.map((entry) => [entry.fileName, entry]));

        expect(entriesByFileName.get('assets/theme-thumbnails/forest-theme-icon.png')?.sourcePath)
            .toBe(forestIcon);
        expect(entriesByFileName.get('assets/theme-thumbnails/example-theme-icon.png')?.sourcePath)
            .toBe(exampleV2Icon);
        expect(entriesByFileName.get('assets/theme-thumbnails/example-v2-theme-icon.png')?.sourcePath)
            .toBe(exampleV2Icon);
    });
});

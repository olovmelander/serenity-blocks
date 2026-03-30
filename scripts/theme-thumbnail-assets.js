import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { THEME_REGISTRY } from '../src/themes/theme-registry.js';

export const THEME_THUMBNAIL_OUTPUT_DIR = 'assets/theme-thumbnails';
export const THEME_THUMBNAIL_SUFFIX = '-theme-icon.png';

function normalizeIconPath(iconPath) {
    if (typeof iconPath !== 'string' || iconPath.length === 0) {
        return null;
    }

    return iconPath.replace(/^[./]+/, '').replace(/\\/g, '/');
}

export function buildThemeThumbnailAssetEntries({
    projectRoot = process.cwd(),
    themeRegistry = THEME_REGISTRY,
    outputDir = THEME_THUMBNAIL_OUTPUT_DIR,
} = {}) {
    const entriesByFileName = new Map();

    themeRegistry.forEach((theme) => {
        if (!theme?.id || typeof theme.icon !== 'string' || !theme.icon.endsWith('.png')) {
            return;
        }

        const iconPath = normalizeIconPath(theme.icon);
        if (!iconPath) {
            return;
        }

        const sourcePath = path.resolve(projectRoot, 'src/themes', iconPath);
        const fileName = path.posix.join(outputDir, `${theme.id}${THEME_THUMBNAIL_SUFFIX}`);

        entriesByFileName.set(fileName, {
            themeId: theme.id,
            fileName,
            sourcePath,
            sourceRelativePath: path.relative(projectRoot, sourcePath),
        });
    });

    return [...entriesByFileName.values()].sort((left, right) => left.fileName.localeCompare(right.fileName));
}

export function createThemeThumbnailAssetPlugin(options = {}) {
    return {
        name: 'serenity-theme-thumbnail-assets',
        apply: 'build',
        generateBundle() {
            const entries = buildThemeThumbnailAssetEntries(options);

            entries.forEach((entry) => {
                if (!existsSync(entry.sourcePath)) {
                    this.warn(
                        `[theme-thumbnails] Missing source icon for "${entry.themeId}": ${entry.sourceRelativePath}`,
                    );
                    return;
                }

                this.emitFile({
                    type: 'asset',
                    fileName: entry.fileName,
                    source: readFileSync(entry.sourcePath),
                });
            });
        },
    };
}

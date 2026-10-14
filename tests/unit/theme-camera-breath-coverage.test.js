import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';

/**
 * Every theme's camera breathes.
 *
 * A camera that never moves turns a theme into a still image, and most themes' own drift
 * runs on periods of minutes, which reads as still too. The shared breath
 * (src/themes/shared/camera-breath.js) is the fix, so every registered theme must reach it:
 * from its own directory, or from the playground effect its scene is built from.
 */

const ROOT = path.resolve(__dirname, '../..');
const THEMES_DIR = path.join(ROOT, 'src/themes');
const BREATH_IMPORT = /from\s+['"][./]*(?:themes\/)?shared\/camera-breath\.js['"]/;
const EFFECT_IMPORT = /from\s+['"]((?:\.\.\/)+playground\/effects\/[^'"]+\.js)['"]/g;

/** Themes that breathe their own way, and why the shared breath does not fit them. */
const OWN_BREATH = new Map([
    // An orthographic camera (no perspective to turn or lean), which already breathes
    // with its own 18 s zoom swell (wolfhour-composition.js).
    ['wolfhour', 'orthographic camera with its own breathing zoom'],
]);

function jsFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return jsFiles(full);
        return entry.name.endsWith('.js') ? [full] : [];
    });
}

function reachesBreath(themeId) {
    for (const file of jsFiles(path.join(THEMES_DIR, themeId))) {
        const source = readFileSync(file, 'utf8');
        if (BREATH_IMPORT.test(source)) return true;
        for (const match of source.matchAll(EFFECT_IMPORT)) {
            const effect = path.resolve(path.dirname(file), match[1]);
            if (BREATH_IMPORT.test(readFileSync(effect, 'utf8'))) return true;
        }
    }
    return false;
}

describe('theme camera breath coverage', () => {
    const ids = THEME_REGISTRY.map((entry) => entry.id);

    it.each(ids.filter((id) => !OWN_BREATH.has(id)))('%s breathes', (themeId) => {
        expect(reachesBreath(themeId)).toBe(true);
    });

    it.each([...OWN_BREATH.keys()])('%s keeps its own breath (exempt, still registered)', (themeId) => {
        expect(ids).toContain(themeId); // a retired theme must leave the list
        expect(reachesBreath(themeId)).toBe(false); // drop the exemption once it does
    });
});

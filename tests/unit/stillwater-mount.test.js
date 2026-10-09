/**
 * Stillwater's place on the page: an empty mount in index.html that the theme appends its one
 * canvas to, and one rule in public/styles/main.css that clips it. The DOM layers and classes the
 * first, CSS-drawn Stillwater was made of are gone and stay gone.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexSource = readFileSync(
    new URL('../../index.html', import.meta.url),
    'utf8',
);
const mainStylesSource = readFileSync(
    new URL('../../public/styles/main.css', import.meta.url),
    'utf8',
);

describe('Stillwater mount', () => {
    it('ships only the runtime canvas mount and no retired DOM surface', () => {
        const mount = indexSource.match(
            /<div id="stillwater-theme" class="theme-container">([\s\S]*?)<\/div>/,
        );
        const mountElements = mount?.[1].replace(/<!--[\s\S]*?-->/g, '').trim();
        const stillwaterCssStart = mainStylesSource.indexOf(
            '/* ================== STILLWATER THEME ================== */',
        );
        const stillwaterCssEnd = mainStylesSource.indexOf(
            '/* =================================================================',
            stillwaterCssStart + 1,
        );
        const stillwaterCss = mainStylesSource.slice(
            stillwaterCssStart,
            stillwaterCssEnd,
        );
        const retiredDomIds = [
            'stillwater-sky',
            'stillwater-distant-trees',
            'stillwater-mid-trees',
            'stillwater-close-trees',
            'stillwater-foreground-trees',
            'stillwater-waterline',
            'stillwater-rocks',
            'stillwater-water',
            'stillwater-figure',
            'stillwater-reflection',
            'stillwater-water-ripples',
            'stillwater-mist-back',
            'stillwater-mist-mid',
            'stillwater-mist-front',
            'stillwater-particles',
            'stillwater-glow',
        ];

        expect(mount).not.toBeNull();
        expect(mountElements).toBe('');
        expect(stillwaterCssStart).toBeGreaterThan(-1);
        expect(stillwaterCssEnd).toBeGreaterThan(stillwaterCssStart);
        retiredDomIds.forEach((id) => {
            expect(indexSource).not.toContain(`id="${id}"`);
            expect(stillwaterCss).not.toContain(`#${id}`);
        });
        // The mount clips its canvas. (Its background colour is the theme's to choose.)
        const mountRule = stillwaterCss.match(/#stillwater-theme\s*\{([^}]*)\}/);
        expect(mountRule).not.toBeNull();
        expect(mountRule[1]).toMatch(/(?:^|[;\s])overflow:\s*hidden\s*;/);
        expect(stillwaterCss).not.toContain('.stillwater-');
    });
});

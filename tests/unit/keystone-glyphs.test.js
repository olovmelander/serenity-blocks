/**
 * Keystone glyphs (src/ui/components/cosmic-icons.js): the icons that name a place in the game
 * are each completed by one solid tile, index.html's static copies are the module's drawings,
 * the settings sprite resolves every reference, and no stock icon set creeps back in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COSMIC_ICON_NAMES, csIconInner } from '../../src/ui/components/cosmic-icons.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

const IDENTITY = ['mode-single', 'mode-infinity', 'mode-stillfall', 'mode-local', 'mode-online', 'mode-serenity',
    'mode-hale', 'mode-odyssey', 'records', 'replays', 'settings', 'themes', 'breathing', 'note'];
const MODES = {
    single: 'mode-single',
    infinity: 'mode-infinity',
    stillfall: 'mode-stillfall',
    'local-multiplayer': 'mode-local',
    'online-multiplayer': 'mode-online',
    serenity: 'mode-serenity',
    hale: 'mode-hale',
    odyssey: 'mode-odyssey',
};
const DOCK = {
    'serenity-hub-icon': 'lotus', 'highscores-icon-btn': 'records', 'open-replays-btn': 'replays', 'settings-btn-global': 'settings',
};
const SPRITE = {
    sliders: 'sliders',
    display: 'display',
    audio: 'volume',
    visual: 'visual',
    pad: 'gamepad',
    home: 'home',
    lotus: 'lotus',
    gear: 'gear',
    keyboard: 'keyboard',
    tip: 'tip',
    power: 'power',
};

/** The drawing inside the first <svg> after `marker`. */
function svgAfter(marker) {
    const at = html.indexOf(marker);
    expect(at, `${marker} in index.html`).toBeGreaterThanOrEqual(0);
    const open = html.indexOf('<svg', at);
    const body = html.indexOf('>', open) + 1;
    return { tag: html.slice(open, body), inner: html.slice(body, html.indexOf('</svg>', body)) };
}

describe('Keystone glyphs', () => {
    it('completes every identity glyph with exactly one solid tile', () => {
        for (const name of IDENTITY) {
            expect(COSMIC_ICON_NAMES).toContain(name);
            expect(csIconInner(name).match(/class="cs-tile"/g), name).toHaveLength(1);
        }
        expect(csIconInner('lotus')).not.toContain('cs-tile');
    });

    it('draws each main-menu mode with its module glyph', () => {
        for (const [mode, glyph] of Object.entries(MODES)) {
            const { tag, inner } = svgAfter(`data-mode="${mode}"`);
            expect(tag).toContain('stroke-width="1.8"');
            expect(inner, mode).toBe(csIconInner(glyph));
        }
    });

    it('draws the dock, the play rail and the corner tiles with their module glyphs', () => {
        for (const [proxy, glyph] of Object.entries(DOCK)) {
            expect(svgAfter(`data-proxy="${proxy}"`).inner, proxy).toBe(csIconInner(glyph));
        }
        expect(svgAfter('<div id="serenity-hub-icon"').inner).toBe(csIconInner('lotus'));
        expect(svgAfter('<button id="settings-btn-global"').inner).toBe(csIconInner('settings'));
        expect(svgAfter('<div id="open-replays-btn"').inner).toBe(csIconInner('replays'));
        expect(svgAfter('<div id="highscores-icon-btn"').inner).toBe(csIconInner('records'));
        expect(svgAfter('<div class="headphone-badge">').inner).toBe(csIconInner('headphones'));
    });

    it('keeps one settings sprite whose symbols are the module glyphs and resolve every reference', () => {
        const symbols = Object.fromEntries([...html.matchAll(/<symbol id="([a-z-]+)" viewBox="0 0 24 24">([\s\S]*?)<\/symbol>/g)]
            .map(([, id, inner]) => [id, inner]));
        expect(Object.keys(symbols).sort()).toEqual(Object.keys(SPRITE).map((id) => `sb-ico-${id}`).sort());
        for (const [id, glyph] of Object.entries(SPRITE)) expect(symbols[`sb-ico-${id}`], id).toBe(csIconInner(glyph));
        for (const [, ref] of html.matchAll(/<use href="#([a-z-]+)"/g)) expect(symbols, ref).toHaveProperty(ref);
    });

    it('ships no stock icon-set drawings (Feather, Lucide, Material)', () => {
        const STOCK = [
            'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', // Feather users
            'M12 2a15.3 15.3 0 0 1 4 10', // Feather globe
            'M3 20L8 10L13 15L21 4', // a trending-up chart
            'M18 2H6v7a6 6 0 0 0 12 0V2Z', // Lucide trophy
            '14.5 17.5 3 6 3 3 6 3 17.5 14.5', // Lucide swords
            'M12 3C7.58 3 4 6.58 4 11v7', // Material headset
        ];
        const files = ['index.html'];
        const walk = (dir) => readdirSync(path.join(repoRoot, dir)).forEach((name) => {
            const rel = path.join(dir, name);
            if (statSync(path.join(repoRoot, rel)).isDirectory()) walk(rel);
            else if (/\.(js|html)$/.test(name) && !/\.test\.js$/.test(name)) files.push(rel);
        });
        walk('src/ui');
        walk('src/core/game-modes');
        for (const file of files) {
            const text = readFileSync(path.join(repoRoot, file), 'utf8');
            for (const signature of STOCK) expect(text.includes(signature), `${signature} in ${file}`).toBe(false);
        }
    });
});

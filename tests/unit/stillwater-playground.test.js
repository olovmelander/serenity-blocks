/**
 * Stillwater — the playground effect (src/playground/effects/stillwater.effect.js), read as text.
 *
 * The effect mounts the same world and post stack the theme ships and drives them from URL
 * parameters, so a capture is a seek to a time with the gameplay that led up to it replayed.
 * Nothing is mounted here (the world itself is driven in stillwater-world.test.js): these tests
 * read the effect's source and pin what a capture script and the URL reference rely on — that
 * it is built from the theme's own modules, and that every parameter it reads is one its header
 * tells of. A new parameter must be added to the header AND to the list below.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import * as effect from '../../src/playground/effects/stillwater.effect.js';
import { STILLWATER_PARTS } from '../../src/themes/stillwater/stillwater-world.js';
import { QUALITY_NAMES } from '../../src/themes/stillwater/stillwater-quality.js';

const source = readFileSync(
    new URL('../../src/playground/effects/stillwater.effect.js', import.meta.url),
    'utf8',
);

/** The header: the first doc comment of the file, where the parameters are told of. */
const header = source.slice(source.indexOf('/**'), source.indexOf('*/', source.indexOf('/**')));

/** Every parameter the effect reads by name: params.get('x'), params.has('x'), num(params, 'x', …). */
const read = [...new Set([
    ...[...source.matchAll(/\bparams\.(?:get|has)\(\s*'([^']+)'\s*\)/g)].map((match) => match[1]),
    ...[...source.matchAll(/\bnum\(\s*params\s*,\s*'([^']+)'/g)].map((match) => match[1]),
])].sort();

/** The parameters of the effect, as of this test. A new one is added here on purpose, with its line in the header. */
const PARAMETERS = [
    'bloom', 'board', 'brush', 'color', 'combo', 'demo', 'event', 'eventAge', 'eventLevel', 'falseColor', 'icon',
    'iconFov', 'iconPitch', 'iconX', 'iconY', 'iconYaw', 'iconZ', 'level', 'lines', 'locks', 'msaa', 'noPost', 'parts',
    'px', 'py', 'quality', 'reduce', 'row', 'statsHud', 'u',
];

const told = (name) => new RegExp(`(?<![A-Za-z])${name}(?![A-Za-z])`).test(header);

describe('stillwater playground effect', () => {
    it('is the effect the playground lists as stillwater, and exports what the playground mounts', () => {
        expect(effect.meta).toMatchObject({ id: 'stillwater' });
        expect(typeof effect.meta.title).toBe('string');
        expect(effect.meta.title.length).toBeGreaterThan(0);
        expect(typeof effect.meta.description).toBe('string');
        expect(effect.meta.description.length).toBeGreaterThan(0);
        expect(typeof effect.create).toBe('function');
        expect(Object.keys(effect).sort()).toEqual(['create', 'meta']);
        // The handle it gives back has what the playground calls.
        const handle = source.slice(source.indexOf('cameraRadius'));
        expect(source.indexOf('cameraRadius')).toBeGreaterThan(0);
        for (const method of ['camera', 'update', 'seek', 'render', 'resize', 'getDiagnostics', 'dispose']) {
            expect(handle, method).toMatch(new RegExp(`^\\s+${method}\\([^)]*\\) \\{`, 'm'));
        }
    });

    it('is built from the theme\'s own world, post, composition and piece colours', () => {
        const imports = [...source.matchAll(/^import\s+[^;]*?\sfrom\s+'([^']+)';/gm)].map((match) => match[1]);
        const theme = '../../themes/stillwater/';
        for (const module of ['stillwater-world.js', 'stillwater-post.js', 'stillwater-composition.js',
            'stillwater-tetrominos.js']) {
            expect(imports, module).toContain(`${theme}${module}`);
        }
        // Nothing of another theme's, and no copy of the scene of its own: three, and the theme.
        for (const from of imports) {
            expect(from === 'three/webgpu' || from.startsWith(theme), from).toBe(true);
        }
        // Each by the name the theme itself uses for it.
        const named = (name, module) => new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '${theme}${module}'`
            .replaceAll('/', '\\/').replaceAll('.', '\\.'));
        expect(source).toMatch(named('StillwaterWorld', 'stillwater-world.js'));
        expect(source).toMatch(named('StillwaterPost', 'stillwater-post.js'));
        expect(source).toMatch(named('readLayoutRects', 'stillwater-composition.js'));
        expect(source).toMatch(named('STILLWATER_TETROMINOS', 'stillwater-tetrominos.js'));
        // It builds the world as a capture (no wall clock anywhere), and makes one world only.
        expect(source.match(/new StillwaterWorld\(/g)).toHaveLength(1);
        expect(source).toMatch(/new StillwaterWorld\(\{[^}]*\bcapture: true\b/);
        expect(source.match(/new StillwaterPost\(/g)).toHaveLength(1);
        // What it mounts it takes down again.
        const dispose = source.slice(source.lastIndexOf('dispose() {'));
        expect(dispose).toMatch(/world\.dispose\(\)/);
        expect(dispose).toMatch(/post\?\.dispose\(\)/);
    });

    it('tells of its parameters in its header', () => {
        expect(header).toContain('URL params:');
        expect(read.length).toBeGreaterThan(10);
        const untold = read.filter((name) => !told(name));
        expect(untold).toEqual([]);
    });

    it('reads every parameter its header gives a value for', () => {
        // name=value in the header is a parameter the reader may set.
        const offered = [...new Set([...header.matchAll(/(?<![A-Za-z])([A-Za-z]+)=/g)].map((match) => match[1]))]
            .sort();
        expect(offered.length).toBeGreaterThan(10);
        expect(offered.filter((name) => !read.includes(name))).toEqual([]);
    });

    it('reads no parameter by a name that is worked out at run time', () => {
        // The one read by a variable is the number helper's own; everything else names its parameter in the source.
        const byVariable = [...source.matchAll(/\bparams\.(?:get|has)\(\s*([^'\s)][^)]*)\)/g)].map((match) => match[1]);
        expect(byVariable).toEqual(['key']);
        expect(source).toMatch(/function num\(params, key, fallback = 0\)/);
        expect(source).not.toMatch(/\bparams\.(?:getAll|entries|keys|forEach)\(/);
        expect(source).not.toMatch(/\blocation\.(?:search|hash|href)\b/);
    });

    it('has exactly the parameters this test lists', () => {
        expect(read).toEqual([...PARAMETERS].sort());
    });

    it('fires every event its header offers, and offers every event it fires', () => {
        const offered = header.match(/event=([A-Za-z|]+)/)[1].split('|').sort();
        const fired = [...new Set([...source.matchAll(/\beventName === '([^']+)'/g)].map((match) => match[1]))].sort();
        expect(offered.length).toBeGreaterThan(4);
        expect(fired).toEqual(offered);
        // The details an event takes are parameters too.
        for (const detail of ['lines', 'row', 'u', 'color', 'eventLevel', 'eventAge']) expect(read).toContain(detail);
    });

    it('names parts and tiers the theme has', () => {
        // The examples its header gives for ?parts= and ?quality= are real ones.
        const parts = header.match(/parts=([a-z,]+)/)[1].split(',').filter(Boolean);
        expect(parts.length).toBeGreaterThan(0);
        for (const part of parts) expect(STILLWATER_PARTS, part).toContain(part);
        const tiers = header.match(/quality=([A-Za-z|]+)/)[1].split('|').filter(Boolean);
        expect(tiers.length).toBeGreaterThan(0);
        for (const tier of tiers) expect(QUALITY_NAMES, tier).toContain(tier);
        // With no ?quality= it builds the tier the game ships as its default.
        expect(source).toMatch(/params\.get\('quality'\) \|\| 'High'/);
    });
});

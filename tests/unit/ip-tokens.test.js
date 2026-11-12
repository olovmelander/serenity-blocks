import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BLOCKED_TOKENS, HOUSE_PHRASES, HOUSE_PHRASES_PENDING, RATCHET_TOKENS, compareToBaseline, countTokens,
    findHousePhrases, findToken, isHouseSurface, screenHouseWords, scriptLiterals,
} from '../../scripts/ip-tokens.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const token = (id) => [...BLOCKED_TOKENS, ...RATCHET_TOKENS].find((t) => t.id === id);
const phrase = (id) => HOUSE_PHRASES.find((p) => p.id === id);
const ids = (hits) => hits.map((hit) => hit.id);

describe('IP-string gate, class C (scripts/ip-tokens.mjs)', () => {
    it('finds blocked names in any spelling, and not inside ordinary words', () => {
        expect(findToken(token('gargantua'), 'const GARGANTUA_LOCK = 1; // Gargantua')).toHaveLength(2);
        expect(findToken(token('lindstrom'), 'Lindström, Lindstrom and Bengt')).toHaveLength(3);
        expect(findToken(token('akira'), 'NEO-TOKYO // 2042 and neo tokyo')).toHaveLength(2);
        expect(findToken(token('interstellar (the film)'), 'interstellar gas between the stars')).toHaveLength(0);
        expect(findToken(token('interstellar (the film)'), "Interstellar's black hole")).toHaveLength(1);
        expect(findToken(token('hale'), 'inhale, exhale, Hale Sessions, hale-flow__caution')).toHaveLength(2);
    });

    it('counts file names too, binaries included', () => {
        const counts = countTokens(BLOCKED_TOKENS, ['docs/images/traced-gargantua.jpg', 'src/a.js'],
            (path) => (path.endsWith('.js') ? 'nothing here' : null));
        expect(counts.get('gargantua').count).toBe(1);
        expect(counts.get('gargantua').hits[0]).toContain('(file name)');
    });

    it('lets a ratcheted count fall, never rise', () => {
        const counts = new Map([['ghibli', { count: 5 }], ['hale', { count: 2 }], ['chiral', { count: 1 }]]);
        const { over, under } = compareToBaseline(counts, { ghibli: 4, hale: 3 });
        expect(over).toEqual([
            { id: 'ghibli', count: 5, baseline: 4 },
            { id: 'chiral', count: 1, baseline: 0 },
        ]);
        expect(under).toEqual([{ id: 'hale', count: 2, baseline: 3 }]);
    });
});

describe('IP-string gate, class D: house words (scripts/ip-tokens.mjs)', () => {
    it('blocks the six phrases', () => {
        expect(HOUSE_PHRASES.map((p) => p.id)).toEqual([
            'classic game', 'classic falling-block', 'classic block puzzle', 'classic puzzle', 'familiar puzzle',
            'perfect clear',
        ]);
    });

    it('finds a phrase in any case and across a line break, and only as whole words', () => {
        const count = (id, text) => findToken(phrase(id), text).length;
        expect(count('classic game', 'as in the Classic Game, and the CLASSIC\n   games of old')).toBe(2);
        expect(count('classic game', 'neoclassic game; classic gameplay; a classic. Game on')).toBe(0);
        expect(count('classic falling-block', 'Classic falling-block play, classic falling block strategy')).toBe(2);
        expect(count('classic block puzzle', 'the purity of classic block puzzle gameplay')).toBe(1);
        expect(count('classic puzzle', "the game's classic puzzle mechanics; classic puzzles")).toBe(2);
        expect(count('familiar puzzle', 'The familiar puzzle foundation; an unfamiliar puzzle')).toBe(1);
        expect(count('perfect clear', 'Perfect clear, PERFECT  CLEAR and two perfect clears')).toBe(3);
    });

    it('leaves the code\'s own names for the event alone', () => {
        const names = 'PERFECT_CLEAR perfectClear perfect-clear game:perfect-clear onPerfectClear sfx_perfect_clear';
        expect(findToken(phrase('perfect clear'), names)).toHaveLength(0);
        expect(findToken(phrase('perfect clear'), 'an imperfect clear; a perfect clearance')).toHaveLength(0);
    });

    it('reads a script\'s string and template literals, and nothing else of it', () => {
        const source = [
            '// a comment with \'quotes\' and a perfect clear',
            'const a = \'one\'; /* "not this" */',
            'const re = /["\'`]\\/\\/ perfect clear/g;',
            'const b = `two ${a} three`;',
            'const c = "four // not a comment";',
            'const d = `five',
            'six`;',
        ].join('\n');
        expect(scriptLiterals(source)).toEqual([
            { text: 'one', line: 2 },
            { text: 'two ', line: 4 },
            { text: ' three', line: 4 },
            { text: 'four // not a comment', line: 5 },
            { text: 'five\nsix', line: 6 },
        ]);
    });

    it('looks for "perfect clear" where a player can read it: a script\'s literals, any other file whole', () => {
        const script = [
            '/** Perfect clear: the well emptied. */',
            'export function playPerfectClear() { // the perfect clear\'s dawn',
            '    return { id: \'perfect-clear\', title: \'Clean canvas\' };',
            '}',
        ].join('\n');
        expect(findHousePhrases('src/ui/effects.js', script)).toEqual([]);

        const shown = [
            script,
            'const kicker = waves >= 2 ? `Combo` : \'Perfect clear\';',
            'const html = `<b>',
            '  Perfect',
            '  clear</b>`;',
        ].join('\n');
        const hits = findHousePhrases('src/ui/effects.js', shown);
        expect(ids(hits)).toEqual(['perfect clear', 'perfect clear']);
        expect(hits.map((hit) => hit.line)).toEqual([5, 7]);

        // Markup, styles, data and prose: the whole text.
        expect(ids(findHousePhrases('index.html', '<!-- perfect clear --><p>Perfect clear</p>'))).toHaveLength(2);
        expect(ids(findHousePhrases('public/data/strings.json', '{"a":"Perfect clear"}'))).toEqual(['perfect clear']);
        expect(ids(findHousePhrases('game_description.md', 'Chase a perfect clear.'))).toEqual(['perfect clear']);
    });

    it('looks for the other phrases in the whole text, comments included', () => {
        const script = '// Garbage arrives in full, as in the classic game.\nexport const A = 1;';
        expect(findHousePhrases('src/ui/match.js', script)).toEqual([
            expect.objectContaining({ id: 'classic game', line: 1 }),
        ]);
        expect(ids(findHousePhrases('README.md', 'Classic falling-block gameplay on a familiar puzzle foundation.')))
            .toEqual(['classic falling-block', 'familiar puzzle']);
        expect(findHousePhrases('README.md', 'A falling-block puzzle game set inside living worlds.')).toEqual([]);
    });

    it('covers the runtime text, the README and the game\'s description, tests aside', () => {
        const covered = ['src/ui/a.js', 'src/themes/x/x.css', 'electron/main.js', 'public/styles/a.css',
            'index.html', 'README.md', 'game_description.md'];
        const passedOver = ['src/core/__tests__/garbage.test.js', 'src/core/ai/bot-ai.test.js',
            'tests/unit/a.test.js', 'docs/A.md', 'scripts/a.mjs', 'CREDITS.md', 'playground.html'];
        for (const file of covered) expect(isHouseSurface(file), file).toBe(true);
        for (const file of passedOver) expect(isHouseSurface(file), file).toBe(false);
    });

    it('holds the game\'s own description and README to it', () => {
        for (const file of ['README.md', 'game_description.md']) {
            const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
            expect(findHousePhrases(file, text), file).toEqual([]);
        }
    });

    it('lists only files that still carry their phrase as pending', () => {
        for (const [file, pending] of HOUSE_PHRASES_PENDING) {
            expect(isHouseSurface(file), file).toBe(true);
            const found = new Set(ids(findHousePhrases(file, fs.readFileSync(path.join(repoRoot, file), 'utf8'))));
            // Every listed phrase is still there (a stale entry is removed), and nothing else is.
            expect([...found].sort(), file).toEqual([...pending].sort());
        }
    });

    it('reports a pending file\'s phrase without failing, and fails an entry that has gone stale', () => {
        const files = new Map([
            ['src/ui/match.js', 'const help = \'Garbage arrives in full, as in the classic game.\';'],
            ['src/ui/hud.js', 'const title = \'Perfect clear\';'],
            ['src/core/__tests__/hud.test.js', 'it(\'perfect clear\', () => {});'],
            ['docs/NOTES.md', 'A perfect clear in the classic game.'],
            ['public/assets/logo.png', null],
        ]);
        const read = (file) => files.get(file) ?? null;
        const pending = new Map([['src/ui/match.js', ['classic game']]]);

        const screened = screenHouseWords([...files.keys()], read, pending);
        expect(screened.fileCount).toBe(2);
        expect(screened.notes).toEqual([expect.stringMatching(/^src\/ui\/match\.js:1: "classic game" .*pending/)]);
        expect(screened.violations).toEqual([
            expect.stringMatching(/^src\/ui\/hud\.js:1: "perfect clear" .*house words$/),
        ]);

        // The file was reworded: its allowance must go too.
        files.set('src/ui/match.js', 'const help = \'Garbage always arrives in full.\';');
        files.delete('src/ui/hud.js');
        const after = screenHouseWords([...files.keys()], read, pending);
        expect(after.notes).toEqual([]);
        expect(after.violations).toEqual([
            expect.stringContaining('src/ui/match.js no longer carries "classic game": remove its entry'),
        ]);
        expect(screenHouseWords([...files.keys()], read, new Map()).violations).toEqual([]);
    });

    it('finds none in the tracked tree beyond what is pending', () => {
        const listed = spawnSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 << 20 });
        if (listed.status !== 0) return; // no git here: the gate itself walks the tree
        const tracked = listed.stdout.split('\0').filter(Boolean);
        const text = /\.(js|mjs|cjs|ts|mts|css|html|svg|json|txt|md|xml|webmanifest)$/i;
        const read = (file) => {
            const full = path.join(repoRoot, file);
            return text.test(file) && fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
        };
        const screened = screenHouseWords(tracked, read);
        expect(screened.fileCount).toBeGreaterThan(1000);
        expect(screened.violations).toEqual([]);
    }, 60_000);
});

import { describe, expect, it } from 'vitest';
import {
    BLOCKED_TOKENS, RATCHET_TOKENS, compareToBaseline, countTokens, findToken,
} from '../../scripts/ip-tokens.mjs';

const token = (id) => [...BLOCKED_TOKENS, ...RATCHET_TOKENS].find((t) => t.id === id);

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

    it('counts the genre mark in runtime source as prose only, never identifiers or keys', () => {
        const source = [
            "const isTetris = lines === 4; emit('tetris'); me.tetris += 1; const o = { tetris: 1 };",
            '// a Tetris Effect-style burst',
        ].join('\n');
        const counts = countTokens(RATCHET_TOKENS, ['src/x.js', 'docs/y.md'], () => source);
        expect(counts.get('genre-mark-in-source').count).toBe(1);
        expect(counts.get('genre-mark-in-source').hits[0]).toMatch(/^src\/x\.js:2:/);
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

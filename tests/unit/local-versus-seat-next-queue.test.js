/**
 * A local match's spawn callback draws each seat's next pieces. Seats 3 and 4 used to fall to
 * player 2's panel: their own previews froze on the round's first draw while player 2's showed
 * three players' pieces in turn.
 *
 * The callback is built inside src/main.js, which has no importable surface, so this runs the
 * statement that chooses the panel, as written there.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync('src/main.js', 'utf8');
const [, chooser] = mainSource.match(/const nextCanvases = ([\s\S]+?);\n/) || [];

// eslint-disable-next-line no-new-func -- runs the statement above, as src/main.js has it.
const chooseCanvases = new Function('currentMode', 'playerNum', `return ${chooser};`);

const panels = () => new Map([1, 2, 3, 4].map((seat) => [seat, [`p${seat}-next-0`]]));
const app = { p1NextCanvases: ['app-p1'], p2NextCanvases: ['app-p2'] };

describe('the next-piece panel a local seat draws to', () => {
    it('finds the statement in src/main.js', () => {
        expect(chooser).toBeTruthy();
    });

    it.each([1, 2, 3, 4])('gives seat %i its own panel', (seat) => {
        const currentMode = { playerNextCanvases: panels() };

        expect(chooseCanvases.call(app, currentMode, seat)).toEqual([`p${seat}-next-0`]);
    });

    it('falls back to the app\'s panels when no mode holds any', () => {
        expect(chooseCanvases.call(app, null, 1)).toBe(app.p1NextCanvases);
        expect(chooseCanvases.call(app, null, 2)).toBe(app.p2NextCanvases);
    });
});

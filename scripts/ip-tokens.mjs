/**
 * Class C of the IP-string gate (scripts/ip-string-gate.mjs): names from other people's films,
 * games and art (added 2026-11-03). A theme may evoke a mood; it may not name another work, its
 * coinages, or a living (or in-copyright) artist, in player copy, code, comments, tests, docs or
 * file names.
 *
 * Two kinds:
 *  - BLOCKED: gone from the tree. Any use fails: tracked text, tracked file names, the built dist/.
 *  - RATCHETED: still present while renames are pending. Counted per token over tracked text and
 *    tracked file names and held at or under the committed baseline in ip-token-ratchet.json, so a
 *    new use fails at once while the count is burned down (`--update` lowers the baseline; it never
 *    raises it).
 *
 * Class D, further down: the house words (HOUSE_PHRASES).
 */
import { createRequire } from 'node:module';

/**
 * Class A: the genre mark. Shipped surfaces only (public/, index.html, the runtime source, dist/
 * and the packaged desktop build).
 */
export const GENRE_TOKEN = /tetris|tetrimino/gi;

/**
 * Class B: names from other people's fictional worlds, anywhere in the tracked tree and in what
 * ships. Keep to proper nouns and coinages that belong to one franchise; plain words that a
 * desert, a worm or a geyser needs ("dune", "sand", "worm", "spice" on its own) stay usable.
 */
export const WORLD_TOKEN =
    /arrakis|shai[\s-]?hulud|fremen|melange|muad'?dib|harkonnen|atreides|sardaukar|bene\s+gesserit|kwisatz|lisan\s+al[\s-]?gaib|crysknife|stillsuit|ornithopter|sietch|wormsign|spice\s+blows?|thumper|dune[\s-]+inspired|inspired\s+by\s+dune|dune\s+(?:film|movie|novel|franchise)/gi;

/** @typedef {{ id: string, re: RegExp, scope?: (path: string) => boolean }} IpToken */

/** @type {IpToken[]} */
export const BLOCKED_TOKENS = [
    { id: 'gargantua', re: /gargantua/gi },
    { id: 'interstellar (the film)', re: /interstellar['’]s|\bin interstellar\b|interstellar\s*\((?:film|movie)\)/gi },
    { id: 'lindstrom', re: /lindstr(?:ö|o|oe)m|\bbengt\b|kvinnan\s+alpha/gi },
    { id: 'akira', re: /\bakira\b|neo[\s_-]?tokyo/gi },
    { id: 'cyberpunk-lore', re: /ripperdocs?|arasaka|militech/gi },
    { id: 'death-stranding', re: /death[\s_-]+stranding|chiralium/gi },
    { id: 'mononoke', re: /mononoke/gi },
];

/** @type {IpToken[]} */
export const RATCHET_TOKENS = [
    { id: 'genre-mark', re: /tetris|tetrimino/gi },
    { id: 'ghibli', re: /ghibli|totoro|ponyo|nausica[aä]|laputa|howl['’]?s[\s_-]+moving|spirited[\s_-]+away/gi },
    { id: 'cyberpunk', re: /cyberpunk|netrunner|night[\s_-]+city/gi },
    { id: 'chiral', re: /chiral/gi },
    { id: 'wim-hof', re: /wim[\s_-]?hof/gi },
    { id: 'hale', re: /\bhale\b/gi },
    { id: 'sky-children', re: /sky[\s_-]?children/gi },
    { id: 'thatgamecompany', re: /thatgamecompany|\babz[uû]\b|journey\s+\((?:game|thatgamecompany)/gi },
];

/**
 * Class D: house words (2026-11-12). The game describes itself in its own terms, never by
 * pointing at an older game of its kind, and it has its own names for its moments (an emptied
 * well is a "Clean canvas"). Checked in the runtime text (tracked text under src/, electron/ and
 * public/, and index.html; test files aside), in README.md and game_description.md, and in the
 * built dist/.
 *
 * A phrase is looked for in the whole text of a file, comments included. One marked `shownOnly`
 * is looked for only where a player can read it: in a script, its string and template literals
 * (the code keeps its internal names for the event, and its comments about them); in any other
 * file, the whole text.
 *
 * @typedef {{ id: string, re: RegExp, shownOnly?: boolean }} HousePhrase
 */

/** @type {HousePhrase[]} */
export const HOUSE_PHRASES = [
    { id: 'classic game', re: /\bclassic\s+games?\b/gi },
    { id: 'classic falling-block', re: /\bclassic\s+falling[\s-]+blocks?\b/gi },
    { id: 'classic block puzzle', re: /\bclassic\s+block[\s-]+puzzles?\b/gi },
    { id: 'classic puzzle', re: /\bclassic\s+puzzles?\b/gi },
    { id: 'familiar puzzle', re: /\bfamiliar\s+puzzles?\b/gi },
    { id: 'perfect clear', re: /\bperfect\s+clears?\b/gi, shownOnly: true },
];

/**
 * Files that still carry a house phrase while its rewording lands on another branch, as
 * path -> phrase ids. A listed hit is reported, not failed; an entry whose file no longer has
 * the phrase fails the gate, so it is removed with the merge that makes it stale.
 * @type {Map<string, string[]>}
 */
export const HOUSE_PHRASES_PENDING = new Map();

const HOUSE_FILES = new Set(['index.html', 'README.md', 'game_description.md']);
const HOUSE_ROOTS = /^(src|electron|public)\//;
const TEST_FILE = /(^|\/)__tests__\/|\.test\.[cm]?[jt]s$/;
const SCRIPT_FILE = /\.(js|mjs|cjs|ts|mts)$/i;

/** Whether a tracked path is one the house words are checked in. */
export function isHouseSurface(path) {
    return HOUSE_FILES.has(path) || (HOUSE_ROOTS.test(path) && !TEST_FILE.test(path));
}

const requireHere = createRequire(import.meta.url);
/** @type {typeof import('typescript') | null} */
let ts = null;

/**
 * The string and template literals of a script, as { text, line }: what the program can put on
 * screen. Comments, identifiers and regular expressions are left out. Parsed with the
 * TypeScript compiler (loaded on first use), so a quote in a regular expression or a comment
 * marker in a string cannot mislead it.
 * @param {string} source
 * @param {string} [fileName]
 * @returns {Array<{ text: string, line: number }>}
 */
export function scriptLiterals(source, fileName = 'script.js') {
    ts ??= requireHere('typescript');
    const { SyntaxKind } = ts;
    const kind = /\.m?ts$/i.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, kind);
    const pieces = new Set([
        SyntaxKind.StringLiteral, SyntaxKind.NoSubstitutionTemplateLiteral,
        SyntaxKind.TemplateHead, SyntaxKind.TemplateMiddle, SyntaxKind.TemplateTail,
    ]);
    const literals = [];
    /** @param {import('typescript').Node} node */
    const visit = (node) => {
        if (pieces.has(node.kind)) {
            const { text } = /** @type {import('typescript').LiteralLikeNode} */ (node);
            literals.push({ text, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    return literals;
}

/**
 * The house phrases in one file, as { id, line, context }.
 * @param {string} path  forward slashes; its extension decides how a `shownOnly` phrase is read
 * @param {string} source
 * @returns {Array<{ id: string, line: number, context: string }>}
 */
export function findHousePhrases(path, source) {
    const hits = [];
    let literals = null;
    for (const phrase of HOUSE_PHRASES) {
        if (source.search(phrase.re) < 0) continue;
        if (phrase.shownOnly && SCRIPT_FILE.test(path)) {
            literals ??= scriptLiterals(source, path);
            for (const literal of literals) {
                for (const hit of findToken(phrase, literal.text)) {
                    hits.push({ id: phrase.id, line: literal.line + hit.line - 1, context: hit.context });
                }
            }
        } else {
            for (const hit of findToken(phrase, source)) hits.push({ id: phrase.id, ...hit });
        }
    }
    return hits;
}

/**
 * Screen tracked files for the house phrases.
 * @param {string[]} paths  tracked paths, forward slashes
 * @param {(path: string) => string | null} readText  a file's text, or null to pass it over
 * @param {Map<string, string[]>} [pending]
 * @returns {{ violations: string[], notes: string[], fileCount: number }}  `notes` are the
 *   pending hits; a pending entry with no hit left is a violation
 */
export function screenHouseWords(paths, readText, pending = HOUSE_PHRASES_PENDING) {
    const violations = [];
    const notes = [];
    const seen = new Set();
    let fileCount = 0;
    for (const path of paths) {
        if (!isHouseSurface(path)) continue;
        const text = readText(path);
        if (text === null) continue;
        fileCount++;
        const allowed = pending.get(path) ?? [];
        for (const hit of findHousePhrases(path, text)) {
            const line = `${path}:${hit.line}: "${hit.id}" …${hit.context}…`;
            if (allowed.includes(hit.id)) {
                seen.add(`${path}\n${hit.id}`);
                notes.push(`${line} (pending: HOUSE_PHRASES_PENDING)`);
            } else {
                violations.push(`${line} — house words`);
            }
        }
    }
    for (const [path, ids] of pending) {
        for (const id of ids) {
            if (seen.has(`${path}\n${id}`)) continue;
            violations.push(
                `${path} no longer carries "${id}": remove its entry from HOUSE_PHRASES_PENDING `
                    + '(scripts/ip-tokens.mjs)',
            );
        }
    }
    return { violations, notes, fileCount };
}

/** Matches of one token in a text, as { line, context }. */
export function findToken(token, source) {
    const hits = [];
    token.re.lastIndex = 0;
    for (const match of source.matchAll(token.re)) {
        const start = Math.max(0, match.index - 24);
        hits.push({
            line: source.slice(0, match.index).split('\n').length,
            context: source.slice(start, match.index + match[0].length + 24).replace(/\s+/g, ' ').trim(),
        });
    }
    return hits;
}

/**
 * Count every token over tracked files: their text (when `readText` returns one) and their paths.
 * @param {IpToken[]} tokens
 * @param {string[]} paths  tracked paths, forward slashes
 * @param {(path: string) => string | null} readText
 * @returns {Map<string, { count: number, hits: string[] }>}
 */
export function countTokens(tokens, paths, readText) {
    const result = new Map(tokens.map((token) => [token.id, { count: 0, hits: [] }]));
    for (const path of paths) {
        const text = readText(path);
        for (const token of tokens) {
            if (token.scope && !token.scope(path)) continue;
            const entry = result.get(token.id);
            if (!token.scope) {
                const named = findToken(token, path);
                if (named.length) {
                    entry.count += named.length;
                    entry.hits.push(`${path} (file name)`);
                }
            }
            if (text === null) continue;
            for (const hit of findToken(token, text)) {
                entry.count += 1;
                entry.hits.push(`${path}:${hit.line}: …${hit.context}…`);
            }
        }
    }
    return result;
}

/**
 * Compare ratcheted counts to the baseline.
 * @returns {{ over: Array<{ id: string, count: number, baseline: number }>,
 *             under: Array<{ id: string, count: number, baseline: number }> }}
 */
export function compareToBaseline(counts, baseline) {
    const over = [];
    const under = [];
    for (const [id, { count }] of counts) {
        const allowed = Number.isFinite(baseline?.[id]) ? baseline[id] : 0;
        if (count > allowed) over.push({ id, count, baseline: allowed });
        else if (count < allowed) under.push({ id, count, baseline: allowed });
    }
    return { over, under };
}

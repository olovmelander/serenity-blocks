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
 */

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
    { id: 'ghibli', re: /ghibli|totoro|ponyo|nausica[aä]|laputa|howl['’]?s[\s_-]+moving|spirited[\s_-]+away/gi },
    { id: 'cyberpunk', re: /cyberpunk|netrunner|night[\s_-]+city/gi },
    { id: 'chiral', re: /chiral/gi },
    { id: 'wim-hof', re: /wim[\s_-]?hof/gi },
    { id: 'hale', re: /\bhale\b/gi },
    { id: 'sky-children', re: /sky[\s_-]?children/gi },
    { id: 'thatgamecompany', re: /thatgamecompany|\babz[uû]\b|journey\s+\((?:game|thatgamecompany)/gi },
];

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

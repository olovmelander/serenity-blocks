#!/usr/bin/env node
/**
 * Bring the breath-cue lines of scripts/tts-script.json in line with the words in the source:
 *
 *   - one group `cues_<session>` per Hale session, from src/ui/effects/breathing/session-cues.js;
 *   - the `worlds` group: each world's introduction (kept as written), then its couplets, its
 *     hold and its rest words, from src/ui/effects/breathing/breath-catalogue.js.
 *
 * A take's words are spoken with a beat for each comma and at the end: "Breathe in, softly" is
 * the line "Breathe in... softly...". A quick take, for a breath of a second (a `quick` list in
 * session-cues.js, or the out-words of a world whose out-breath is under MIN_CUE_SECONDS), is
 * said crisply: "Let go" is the line "Let go.", in the voice's `quick` delivery (none of the calm
 * tags, which draw even one word out past a second, and a short tail). A line that already says
 * its words keeps its text exactly, so its recording stays current; a reworded one is recorded
 * again by `npm run tts:record`, and `npm run tts:index -- --prune` then removes the clips of
 * lines that left.
 *
 *   npm run tts:cues                 rewrite the cue lines
 *   npm run tts:cues -- --check      exit 1 if they are out of line (writes nothing)
 *
 * Works on the text, so the rest of the file keeps its layout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRIPT_FILE } from './tts-script.mjs';
import { BREATH_WORLDS, worldCuePairs, worldPauseCues } from '../src/ui/effects/breathing/breath-catalogue.js';
import { MIN_CUE_SECONDS } from '../src/ui/effects/breathing/cue-variety.js';
import { SESSION_CUES } from '../src/ui/effects/breathing/session-cues.js';

/** A session's name, and the sentence sent before each of its cues (not spoken) to set its tone. */
const SESSIONS = {
    FIRST: ['Hale First Breath', 'Follow the light, and breathe slowly through your nose.'],
    TIDE: ['Hale Tide', 'Listen to the water, and breathe slowly with the waves.'],
    ROOTS: ['Hale Roots', 'Feel the ground beneath you, and breathe slowly.'],
    UNWIND: ['Hale Unwind', 'The day is over. Breathe slowly, and let it go.'],
    SUNRISE: ['Hale Sunrise', 'Sit tall, and breathe lightly through your nose.'],
    REST: ['Hale Rest', 'It is night. Breathe slowly, ready for sleep.'],
    FLOW: ['Hale Flow', 'Follow the shape, each side the same length.'],
    BASE: ['Hale Base', 'Breathe steadily through your nose, full and never forced.'],
    ELIXIR: ['Hale Elixir', 'Breathe gently through your nose, and settle.'],
};
/** A set spoken in another manner than its session: its own sentence of context. */
const SET_CONTEXT = {
    'ELIXIR.round': 'Breathe strongly through the mouth, in and out.',
    'ELIXIR.release': 'One deep breath in, held at the top.',
    'BASE.release': 'One full breath in, held at the top.',
    'BASE.settle': 'Breathe slowly through your nose, and let your body soften.',
};
const WORLDS_ABOUT = 'The twelve breathing worlds: an introduction spoken as a world begins in the Breathing tab, '
    + 'and the world\'s cue words (spoken in sessions and practice once the plain cues have taught the rhythm). For '
    + 'the breath in and out, its own couplet (_in, _out) and four more (_in_2/_out_2 ...): a couplet is spoken '
    + 'together. For its pauses, where its rhythm has them, words for the hold with the lungs full (_hold ...) and '
    + 'the rest with them empty (_rest ...). The words are written in breath-catalogue.js (cues, moreCues, holdCues, '
    + 'restCues), which the guide shows. Kept in line by npm run tts:cues.';

/** 'Breathe in, softly' is spoken "Breathe in... softly...". */
export const spokenCue = (words) => `${words.replace(/, /g, '... ')}...`;
/** A quick take, for a breath of a second, is said crisply: 'Let go' is spoken "Let go.". */
export const quickCue = (words) => `${words}.`;
/** The delivery a quick take is recorded in (tts-script.json → voice.deliveries). */
export const QUICK_DELIVERY = 'quick';

const line = (id, text, { context, delivery } = {}) => {
    const how = delivery ? `, "delivery": ${JSON.stringify(delivery)}` : '';
    const more = context ? `, "context": { "previous": ${JSON.stringify(context)} }` : '';
    return `        { "id": ${JSON.stringify(id)}${how}, "text": ${JSON.stringify(text)}${more} },`;
};
/** A take's line: a quick one crisply, in the quick delivery; any other with its beats. */
const takeLine = (id, words, { quick = false, context } = {}) => (quick
    ? line(id, quickCue(words), { context, delivery: QUICK_DELIVERY })
    : line(id, spokenCue(words), { context }));
/** A list's last line closes without a comma. */
const closed = (lines) => lines.map((text, index) => (index === lines.length - 1 ? text.replace(/,$/, '') : text));

/** @param {string} before the script as text @returns {string} the script with its cue lines in line */
export function syncCueLines(before) {
    const eol = before.includes('\r\n') ? '\r\n' : '\n';
    const lines = before.split(eol);
    /** [first, last] line of a group's block: its `    {` to its `    }` or `    },`. */
    const blockOf = (id) => {
        const at = lines.findIndex((text) => text === `      "id": "${id}",`);
        if (at < 0) return null;
        let end = at;
        while (!/^ {4}\},?$/.test(lines[end])) end += 1;
        return [at - 1, end];
    };

    // The session groups are rebuilt whole (with the shared `cues` group of older scripts).
    ['cues', ...Object.keys(SESSIONS).map((id) => `cues_${id.toLowerCase()}`)].forEach((id) => {
        const block = blockOf(id);
        if (block) lines.splice(block[0], block[1] - block[0] + 1);
    });

    // The worlds group: each world's introduction as written, then its cue words.
    const worlds = blockOf('worlds');
    if (!worlds) throw new Error('tts:cues: no "worlds" group in the script');
    const first = lines.findIndex((text, index) => index > worlds[0] && text === '      "lines": [') + 1;
    const last = lines.findIndex((text, index) => index >= first && text === '      ]');
    const intros = new Map(lines.slice(first, last).filter((text) => /_intro",/.test(text))
        .map((text) => [text.match(/"id": "([^"]+)_intro"/)[1], text.replace(/,?$/, ',')]));
    const worldLines = BREATH_WORLDS.flatMap((world) => {
        if (!intros.has(world.id)) throw new Error(`tts:cues: no introduction written for ${world.id}`);
        const pauses = worldPauseCues(world.id);
        const quickOut = world.pattern[2] < MIN_CUE_SECONDS;
        return [
            intros.get(world.id),
            ...worldCuePairs(world.id).flatMap((pair) => [
                takeLine(pair.in.slice('worlds/'.length), pair.words[0]),
                ...(pair.out ? [takeLine(pair.out.slice('worlds/'.length), pair.words[1], { quick: quickOut })] : []),
            ]),
            ...[...pauses.hold, ...pauses.rest]
                .map((take) => takeLine(take.id.slice('worlds/'.length), take.words)),
        ];
    });
    lines.splice(first, last - first, ...closed(worldLines));
    const aboutAt = lines.findIndex((text, index) => index > worlds[0] && text.startsWith('      "about":'));
    lines[aboutAt] = `      "about": ${JSON.stringify(WORLDS_ABOUT)},`;

    // One group per session, after the worlds.
    const groups = Object.entries(SESSIONS).flatMap(([sessionId, [name, context]]) => {
        const takes = Object.entries(SESSION_CUES[sessionId]).flatMap(([setName, set]) => Object.values(set)
            .flatMap((pool) => pool.all.map((take) => takeLine(take.id.split('/')[1], take.words, {
                quick: pool.quick, context: SET_CONTEXT[`${sessionId}.${setName}`],
            }))));
        const about = `${name}'s own breath cues, spoken on its guided breaths: takes for the breath in and out (the `
            + 'first ones plain, to open a guided run), the hold and the rest. No other session uses them. Written in '
            + 'src/ui/effects/breathing/session-cues.js and kept in line by npm run tts:cues; a sentence of context is '
            + 'sent with each (not spoken) so even one word lands calmly.';
        return [
            '    {',
            `      "id": ${JSON.stringify(`cues_${sessionId.toLowerCase()}`)},`,
            `      "about": ${JSON.stringify(about)},`,
            '      "delivery": "cue",',
            `      "context": { "previous": ${JSON.stringify(context)} },`,
            '      "lines": [',
            ...closed(takes),
            '      ]',
            '    },',
        ];
    });
    lines.splice(blockOf('worlds')[1] + 1, 0, ...groups);

    // Only the file's last group closes without a comma.
    let tail = lines.length - 1;
    while (!/^ {4}\},?$/.test(lines[tail])) tail -= 1;
    for (let index = 0; index < tail; index += 1) if (lines[index] === '    }') lines[index] = '    },';
    lines[tail] = '    }';

    const after = lines.join(eol);
    const ids = JSON.parse(after).groups.flatMap((group) => group.lines.map((entry) => `${group.id}/${entry.id}`));
    if (new Set(ids).size !== ids.length) throw new Error('tts:cues: two lines share an id');
    return after;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const check = process.argv.includes('--check');
    const before = fs.readFileSync(SCRIPT_FILE, 'utf8');
    const after = syncCueLines(before);
    const texts = (script) => new Map(JSON.parse(script).groups
        .flatMap((group) => group.lines.map((entry) => [`${group.id}/${entry.id}`, entry.text])));
    const [was, now] = [texts(before), texts(after)];
    const added = [...now.keys()].filter((id) => !was.has(id));
    const removed = [...was.keys()].filter((id) => !now.has(id));
    const reworded = [...now.keys()].filter((id) => was.has(id) && was.get(id) !== now.get(id));
    if (before === after) {
        console.log(`tts:cues: in line (${now.size} lines).`);
    } else if (check) {
        console.log('tts:cues: the script\'s cue lines are out of line with the source. Run `npm run tts:cues`.');
        process.exitCode = 1;
    } else {
        fs.writeFileSync(SCRIPT_FILE, after);
        console.log(`tts:cues: ${was.size} -> ${now.size} lines: ${added.length} new, ${removed.length} removed, `
            + `${reworded.length} reworded${reworded.length ? ` (${reworded.join(', ')})` : ''}. `
            + 'Then: npm run tts:record, and npm run tts:index -- --prune.');
    }
}

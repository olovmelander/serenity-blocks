import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import {
    describe, expect, it, vi,
} from 'vitest';
import {
    BreathworkSessionManager, CLOSINGS, HOLD_READY_LINE, SESSION_WORLDS,
} from '../../src/ui/effects/breathwork-session-manager.js';
import { RECORDED_VOICES } from '../../src/ui/effects/breathwork-recorded-voices.js';
import { HALE_INTENTIONS } from '../../src/ui/serenity-hub/SessionsTab.js';
import { BREATH_WORLDS, worldCuePairs, worldPauseCues } from '../../src/ui/effects/breathing/breath-catalogue.js';
import { MIN_CUE_SECONDS, cueLines } from '../../src/ui/effects/breathing/cue-variety.js';
import { sessionCueTakes } from '../../src/ui/effects/breathing/session-cues.js';
import { buildVoiceIndex, renderVoiceIndex } from '../../scripts/index-breathwork-voices.mjs';
import { SCRIPT_FILE, readScript, scriptLines } from '../../scripts/tts-script.mjs';
import { spokenCue, syncCueLines } from '../../scripts/sync-tts-cues.mjs';
import { readRecordings, wordsOf } from '../../scripts/tts-recordings.mjs';

const ROOT = path.resolve(__dirname, '../..');
const AUDIO = path.join(ROOT, 'public', 'assets', 'audio', 'breathwork');
const INDEX = path.join(ROOT, 'src', 'ui', 'effects', 'breathwork-recorded-voices.js');
const SCRIPT = readScript();
/** Every line written for the voice, by the id the game plays it by. */
const LINES = new Map(scriptLines(SCRIPT).map((line) => [line.key, line]));
const RECORDINGS = readRecordings();

/** Seconds of audio in a PCM WAV file, read from its header. */
function wavSeconds(file) {
    const data = readFileSync(file);
    let offset = 12;
    let byteRate = 0;
    while (offset + 8 <= data.length) {
        const id = data.toString('ascii', offset, offset + 4);
        const size = data.readUInt32LE(offset + 4);
        if (id === 'fmt ') byteRate = data.readUInt32LE(offset + 16);
        if (id === 'data') return size / byteRate;
        offset += 8 + size + (size % 2);
    }
    return NaN;
}

// The manager makes its audio elements as it is built; only its session data is read here.
vi.stubGlobal('Audio', class {
    pause() {}

    load() {}
});
const manager = new BreathworkSessionManager(null);
const { SESSIONS } = manager;
vi.unstubAllGlobals();

/** Every line written for a world: its introduction, its couplets, its hold and rest words. */
const worldLines = (world) => [
    `worlds/${world.id}_intro`,
    ...worldCuePairs(world.id).flatMap((couplet) => [couplet.in, couplet.out]),
    ...Object.values(worldPauseCues(world.id)).flat().map((take) => take.id),
].filter(Boolean);

/** Every line a session can speak: stages, cues, fillers, encouragement, intentions, closing. */
function sessionLines(sessionId, session) {
    const lines = new Set();
    session.phases.forEach(({ audio }) => {
        if (!audio) return;
        [audio.sessionIntro, audio.transition, audio.voice, audio.encourage?.clip, ...(audio.fillers || []),
            // A cue is a pool of takes: every one of them is a line.
            ...[audio.release, audio.cues?.in, audio.cues?.hold, audio.cues?.out, audio.cues?.rest].flatMap(cueLines)]
            .filter(Boolean).forEach((id) => lines.add(id));
    });
    (HALE_INTENTIONS[sessionId] || []).forEach(({ id }) => lines.add(`intentions/${sessionId.toLowerCase()}_${id}`));
    manager.options = { intention: null };
    manager._extraLines(session, sessionId).forEach((id) => lines.add(id));
    return [...lines];
}

describe('The breathing voice script', () => {
    Object.entries(SESSIONS).forEach(([sessionId, session]) => {
        it(`${sessionId}: every line it can speak is written for the voice`, () => {
            const lines = sessionLines(sessionId, session);
            expect(lines.length).toBeGreaterThan(10);
            // A new speaker re-records the script: a line missing from it would keep the old voice.
            lines.forEach((id) => expect(LINES.has(id), `${id} is not in scripts/tts-script.json`).toBe(true));
        });

        it(`${sessionId}: every stage says the same words it shows`, () => {
            session.phases.forEach((phase) => {
                const line = LINES.get(phase.audio?.voice);
                expect(line, `${sessionId} ${phase.prompt}`).toBeTruthy();
                expect(wordsOf(line.text), `${phase.audio.voice}`).toBe(wordsOf(phase.subPrompt));
            });
        });
    });

    it('says the closing words it shows, and the hold bell\'s invitation', () => {
        Object.values(CLOSINGS).forEach((closing) => {
            expect(wordsOf(LINES.get(closing.line)?.text || ''), closing.line).toBe(wordsOf(closing.text));
        });
        expect(LINES.has(HOLD_READY_LINE)).toBe(true);
    });

    it('writes an introduction and cue words for every breathing world', () => {
        BREATH_WORLDS.forEach((world) => {
            expect(LINES.has(`worlds/${world.id}_intro`), world.id).toBe(true);
            // Its own couplet first, then its others: the guide shows the words the voice says.
            const couplets = worldCuePairs(world.id);
            expect(couplets[0].in).toBe(`worlds/${world.id}_in`);
            expect(couplets[0].words).toEqual(world.cues);
            couplets.forEach((couplet) => {
                expect(wordsOf(LINES.get(couplet.in)?.text || ''), couplet.in).toBe(wordsOf(couplet.words[0]));
                // An out-breath too short to speak on has its words on screen only.
                if (!couplet.out) expect(world.pattern[2], world.id).toBeLessThan(MIN_CUE_SECONDS);
                else expect(wordsOf(LINES.get(couplet.out)?.text || ''), couplet.out).toBe(wordsOf(couplet.words[1]));
            });
            Object.values(worldPauseCues(world.id)).flat().forEach((take) => {
                expect(wordsOf(LINES.get(take.id)?.text || ''), take.id).toBe(wordsOf(take.words));
            });
        });
    });

    it('writes every session\'s own cue words as that session data has them', () => {
        const takes = sessionCueTakes();
        expect(takes.length).toBeGreaterThan(150);
        takes.forEach((take) => {
            expect(wordsOf(LINES.get(take.id)?.text || ''), take.id).toBe(wordsOf(take.words));
        });
    });

    it('keeps its cue lines in line with the words in the source (npm run tts:cues)', () => {
        const script = readFileSync(SCRIPT_FILE, 'utf8');
        expect(syncCueLines(script) === script, 'run `npm run tts:cues`, then record what changed').toBe(true);
        expect(spokenCue('Breathe in, softly')).toBe('Breathe in... softly...');
    });

    it('writes nothing the game never plays (every line costs a recording)', () => {
        const played = new Set([
            ...Object.entries(SESSIONS).flatMap(([id, session]) => sessionLines(id, session)),
            ...Object.values(CLOSINGS).map((closing) => closing.line),
            ...BREATH_WORLDS.flatMap((world) => worldLines(world)),
        ]);
        expect([...LINES.keys()].filter((id) => !played.has(id))).toEqual([]);
    });

    it('sets up the speaker and keeps every line short enough to say in a few seconds', () => {
        expect(SCRIPT.voice).toMatchObject({
            provider: 'elevenlabs', model_id: expect.any(String), output_format: expect.stringMatching(/^(wav|pcm)_/),
        });
        ['welcome', 'guide', 'cue', 'still'].forEach((kind) => expect(SCRIPT.voice.deliveries[kind], kind).toMatchObject({ loudness: expect.any(Number) }));
        expect(new Set(LINES.keys()).size).toBe([...scriptLines(SCRIPT)].length);
        LINES.forEach((line, id) => {
            expect(SCRIPT.voice.deliveries[line.delivery], `${id} delivery`).toBeTruthy();
            const words = wordsOf(line.text).split(' ').filter(Boolean).length;
            expect(words, id).toBeGreaterThan(0);
            // About two words a second at a calm pace: 45 words stays under the 25-second limit.
            expect(words, id).toBeLessThanOrEqual(45);
        });
    });
});

describe('The recorded voice', () => {
    it('indexes exactly the recordings that still say their line', () => {
        const fresh = buildVoiceIndex({ audioRoot: AUDIO });
        expect(RECORDED_VOICES).toEqual(fresh.entries);
        expect(readFileSync(INDEX, 'utf8'), 'stale index: run npm run tts:index').toBe(renderVoiceIndex(fresh.entries, fresh.seconds));
        expect(fresh.orphans, 'files no line plays: npm run tts:index -- --prune').toEqual([]);
    });

    it('plays only real recordings, each seconds long', () => {
        Object.entries(RECORDED_VOICES).forEach(([id, file]) => {
            const full = path.join(AUDIO, file);
            expect(existsSync(full), file).toBe(true);
            // A spoken line is seconds long. A clip of minutes is broken (two were nine minutes
            // of near-silence after their words) and costs every session that preloads it.
            const seconds = file.endsWith('.wav') ? wavSeconds(full) : RECORDINGS[id]?.seconds;
            expect(seconds, `${id}: no length recorded`).toBeGreaterThan(0.3);
            expect(seconds, id).toBeLessThan(25);
            expect(statSync(full).size, id).toBeGreaterThan(1000);
        });
    });

    it('has words that fit every breath it cues, and no take too long to ever be said', () => {
        const seconds = (id) => RECORDINGS[id]?.seconds;
        const fits = (id, room) => Boolean(RECORDED_VOICES[id]) && !(seconds(id) > room);
        /** Take id to the longest part of a breath it is ever offered. */
        const longest = new Map();
        const offer = (ids, room, where, atLeast) => {
            ids.forEach((id) => longest.set(id, Math.max(longest.get(id) || 0, room)));
            const fitting = ids.filter((id) => fits(id, room));
            expect(fitting.length, `${where}: takes that fit ${room} s (of ${ids.length})`).toBeGreaterThanOrEqual(atLeast);
        };
        const PARTS = ['in', 'hold', 'out', 'rest'];
        // A session: its own words on its guided breaths (two that fit for the breath in and out,
        // so they vary; one for a pause), and the world's on a fifth breath, when they fit.
        Object.entries(SESSIONS).forEach(([sessionId, session]) => {
            session.phases.forEach((phase) => {
                const { pattern, audio } = phase;
                if (!pattern || !audio?.cues) return;
                const world = phase.type === 'active' ? manager._worldFor(phase, sessionId) : null;
                PARTS.forEach((part, index) => {
                    const room = pattern[index];
                    if (!(room >= MIN_CUE_SECONDS)) return;
                    const where = `${sessionId} ${phase.prompt} (${part})`;
                    const pause = index % 2 === 1;
                    const own = cueLines(audio.cues[part]);
                    if (own.length) offer(own, room, where, pause ? 1 : 2);
                    if (own.length && !pause) {
                        // A run opens on a plain take and goes on in the other wordings.
                        const count = (plain) => audio.cues[part].all
                            .filter((take) => take.plain === plain && fits(take.id, room)).length;
                        expect(count(true), `${where}: plain takes that fit ${room} s`).toBeGreaterThanOrEqual(1);
                        expect(count(false), `${where}: other wordings that fit ${room} s`).toBeGreaterThanOrEqual(2);
                    }
                    if (!world) return;
                    const worlds = pause
                        ? worldPauseCues(world)[part].map((take) => take.id)
                        : worldCuePairs(world).map((couplet) => couplet[part]).filter(Boolean);
                    offer(worlds, room, `${where}, the world's`, 0);
                });
            });
        });
        // A world breathed on its own, in its own rhythm.
        BREATH_WORLDS.forEach((world) => {
            PARTS.forEach((part, index) => {
                const room = world.pattern[index];
                if (!(room >= MIN_CUE_SECONDS)) return;
                const pause = index % 2 === 1;
                const ids = pause
                    ? worldPauseCues(world.id)[part].map((take) => take.id)
                    : worldCuePairs(world.id).map((couplet) => couplet[part]).filter(Boolean);
                if (ids.length) offer(ids, room, `${world.name} (${part})`, pause ? 1 : 2);
            });
        });
        expect(longest.size).toBeGreaterThan(250);
        longest.forEach((room, id) => {
            if (RECORDED_VOICES[id]) expect(seconds(id), `${id} is never said: ${room} s is the most it gets`).toBeLessThanOrEqual(room);
        });
    });

    it('pairs every session with the world it features', () => {
        Object.keys(SESSIONS).forEach((id) => expect(SESSION_WORLDS[id].featured, id).toBeTruthy());
    });
});

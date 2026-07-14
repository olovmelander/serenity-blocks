/**
 * Event-name contract test (plan Phase 3b — prerequisite for §4.1).
 *
 * Both buses silently no-op on unknown/undefined event names, so a member
 * access on a key that does not exist (EVENTS.GAME_OVER, the HOST_MIGRATED
 * emit) produces a dead emit or dead subscription with zero signal. This test
 * statically scans every file that imports a map and asserts each member
 * access resolves to a real key.
 *
 * Known violations are a committed, shrink-only allowlist (same pattern as the
 * lint/fitness ratchets): the six subscriber-side dead references live in
 * theme files whose fix changes visual behavior — they graduate one by one in
 * theme sessions with screenshot validation (WebGPU definition of done),
 * never silently.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENTS } from '../../src/events/event-bus.js';
import { MULTIPLAYER_EVENTS } from '../../src/events/multiplayer-events.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const files = execFileSync('git', ['ls-files', 'src/**/*.js'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file
        && !file.endsWith('.test.js')
        && existsSync(path.join(repoRoot, file)));

// Shrink-only. Each entry is a known-dead reference: the key does not exist in
// the map, so the subscription/emit never fires. Fix = subscribe to a real
// event (or add the key with a producer), then delete the row here.
const KNOWN_VIOLATIONS = new Set([
    'src/themes/himalayan-peak/himalayan-peak-theme.js EVENTS.GAME_OVER',
    'src/themes/himalayan-peak/himalayan-peak-theme.js EVENTS.GAME_START',
    'src/themes/electric-dreams-v3/electric-dreams-v3-theme.js EVENTS.GAME_OVER',
    'src/themes/electric-dreams-v3/electric-dreams-v3-theme.js EVENTS.GAME_START',
    'src/themes/electric-dreams-v3/sim/fluid-emitters.js EVENTS.GAME_OVER',
    'src/themes/neon-district/neon-district-theme.js EVENTS.LINES_CLEARED',
]);

// String-literal event names on the multiplayer bus that predate the map
// (work by literal-matching or are dead). Shrink-only; new events must be
// map keys.
const KNOWN_LITERALS = new Set(['rematch_status', 'hard_drop_effect', 'game:hard_drop']);

function scan(mapName, keys) {
    const violations = [];
    const importRe = new RegExp(`import\\s*{[^}]*\\b${mapName}\\b[^}]*}\\s*from`);
    const memberRe = new RegExp(`\\b${mapName}\\.([A-Z][A-Z0-9_]*)`, 'g');
    for (const file of files) {
        const src = readFileSync(path.join(repoRoot, file), 'utf8');
        if (!importRe.test(src)) continue;
        for (const m of src.matchAll(memberRe)) {
            if (!keys.has(m[1])) violations.push(`${file.replace(/\\/g, '/')} ${mapName}.${m[1]}`);
        }
    }
    return [...new Set(violations)];
}

describe('event-name contract', () => {
    it('every EVENTS.<X> reference resolves to a real key (or is a known violation)', () => {
        const violations = scan('EVENTS', new Set(Object.keys(EVENTS)));
        const fresh = violations.filter((v) => !KNOWN_VIOLATIONS.has(v));
        expect(fresh, 'NEW dead event reference — the key does not exist, this emit/subscription never fires').toEqual([]);
    });

    it('every MULTIPLAYER_EVENTS.<X> reference resolves to a real key', () => {
        const violations = scan('MULTIPLAYER_EVENTS', new Set(Object.keys(MULTIPLAYER_EVENTS)));
        const fresh = violations.filter((v) => !KNOWN_VIOLATIONS.has(v));
        expect(fresh).toEqual([]);
    });

    it('the known-violations allowlist only shrinks (no stale rows)', () => {
        const current = new Set([
            ...scan('EVENTS', new Set(Object.keys(EVENTS))),
            ...scan('MULTIPLAYER_EVENTS', new Set(Object.keys(MULTIPLAYER_EVENTS))),
        ]);
        const stale = [...KNOWN_VIOLATIONS].filter((v) => !current.has(v));
        expect(stale, 'fixed violations must be deleted from KNOWN_VIOLATIONS').toEqual([]);
    });

    it('HOST_MIGRATED is a real map key with an ffa: name (regression pin)', () => {
        expect(MULTIPLAYER_EVENTS.HOST_MIGRATED).toBe('ffa:host-migrated');
    });

    it('no NEW string-literal event names on the multiplayer bus', () => {
        const literals = [];
        for (const file of files) {
            const src = readFileSync(path.join(repoRoot, file), 'utf8');
            for (const m of src.matchAll(/emitMultiplayerEvent\(\s*['"]([^'"]+)['"]/g)) literals.push(m[1]);
            for (const m of src.matchAll(/(?:onMultiplayerEvent|offMultiplayerEvent|onceMultiplayerEvent)\(\s*['"]([^'"]+)['"]/g)) literals.push(m[1]);
        }
        const fresh = [...new Set(literals)].filter((l) => !KNOWN_LITERALS.has(l));
        expect(fresh, 'register new multiplayer events as MULTIPLAYER_EVENTS keys, not literals').toEqual([]);
    });

    it('event values are unique within and across both maps', () => {
        const values = [...Object.values(EVENTS), ...Object.values(MULTIPLAYER_EVENTS)];
        expect(new Set(values).size).toBe(values.length);
    });
});

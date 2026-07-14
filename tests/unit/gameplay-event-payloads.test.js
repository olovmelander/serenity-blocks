/**
 * Gameplay-event payload schema pins (plan §4.6 first slice + 3b).
 *
 * The quartet (+TSPIN/B2B) was emitted from ~25 sites with 6+ divergent
 * shapes; ~212 theme subscriptions consume them. events/gameplay-events.js is
 * now the ONE shape definition — these tests pin the canonical payloads, the
 * consumer-audit safety rules, and that no mode regrows a direct emit.
 */
import {
    describe, it, expect, afterEach,
} from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import {
    emitLineClear, emitCombo, emitPieceLock, emitPerfectClear, emitTSpin, emitB2B,
} from '../../src/events/gameplay-events.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

afterEach(() => {
    for (const name of [...eventBus.listeners.keys()]) eventBus.listeners.delete(name);
});

function capture(eventName, emitFn) {
    const seen = [];
    eventBus.on(eventName, (payload) => seen.push(payload));
    emitFn();
    expect(seen).toHaveLength(1);
    return seen[0];
}

describe('canonical payload shapes', () => {
    it('LINE_CLEAR always carries clearedRows + cascadeCount (consumer-audit rule)', () => {
        const p = capture(EVENTS.LINE_CLEAR, () => emitLineClear({ lineCount: 2 }));
        expect(p).toEqual({ lineCount: 2, clearedRows: [], cascadeCount: 1 });
    });

    it('LINE_CLEAR passes through the full allowed optional set', () => {
        const p = capture(EVENTS.LINE_CLEAR, () => emitLineClear({
            lineCount: 4,
            clearedRows: [20, 21, 22, 23],
            cascadeCount: 2,
            comboCount: 3,
            source: 'odyssey',
            levelId: 12,
            player: 2,
            position: { x: 1, y: 2 },
        }));
        expect(p.comboCount).toBe(3);
        expect(p.source).toBe('odyssey');
        expect(p.levelId).toBe(12);
        expect(p.player).toBe(2);
        expect(p.position).toEqual({ x: 1, y: 2 });
    });

    it('unknown keys are DROPPED — shapes cannot drift back through the helper', () => {
        const p = capture(EVENTS.LINE_CLEAR, () => emitLineClear({
            lineCount: 1, bogus: true, detail: { evil: 1 }, timestamp: 123,
        }));
        expect(p.bogus).toBeUndefined();
        expect(p.detail).toBeUndefined(); // ~10 themes unwrap payload?.detail || payload
        expect(p.timestamp).toBeUndefined();
    });

    it('COMBO / TSPIN / B2B / PIECE_LOCK / PERFECT_CLEAR canonical fields', () => {
        expect(capture(EVENTS.COMBO, () => emitCombo({ comboCount: 5, player: 1 })))
            .toEqual({ comboCount: 5, player: 1 });
        expect(capture(EVENTS.TSPIN, () => emitTSpin({ lineCount: 2, source: 'infinity' })))
            .toEqual({ lineCount: 2, source: 'infinity' });
        expect(capture(EVENTS.B2B, () => emitB2B()))
            .toEqual({ active: true });
        const piece = {
            shapeKey: 'T', x: 4, y: 18, shape: [[1]],
        };
        expect(capture(EVENTS.PIECE_LOCK, () => emitPieceLock({ piece })))
            .toEqual({ piece });
        expect(capture(EVENTS.PERFECT_CLEAR, () => emitPerfectClear({ depth: 3, perfectClearBonus: 3750, source: 'online' })))
            .toEqual({ depth: 3, perfectClearBonus: 3750, source: 'online' });
    });
});

describe('one emit site per event (tripwire)', () => {
    const QUARTET_RE = /eventBus\.emit\(\s*EVENTS\.(LINE_CLEAR|COMBO|PIECE_LOCK|PERFECT_CLEAR|TSPIN|B2B)\b/g;

    // Shrink-only allowlist. main.js's six emits live in the LEGACY loops that
    // plan §5.5 deletes outright — migrate or delete with that phase.
    // Theme files are out of scope: their emits are dev/QA-harness synthetics.
    const KNOWN = new Set(['src/main.js']);

    it('no direct quartet emit outside events/gameplay-events.js (core scope)', () => {
        const files = execFileSync('git', ['ls-files', 'src/core/**/*.js', 'src/main.js', 'src/events/**/*.js'], { cwd: repoRoot, encoding: 'utf8' })
            .split('\n').filter((f) => f && !f.endsWith('.test.js'))
            .map((f) => f.replace(/\\/g, '/'));
        const offenders = [];
        for (const file of files) {
            if (file === 'src/events/gameplay-events.js' || KNOWN.has(file)) continue;
            const src = readFileSync(path.join(repoRoot, file), 'utf8');
            for (const m of src.matchAll(QUARTET_RE)) offenders.push(`${file}: EVENTS.${m[1]}`);
        }
        expect(offenders, 'use the emit helpers in events/gameplay-events.js').toEqual([]);
    });

    it('the duplicate-onPerfectClear bug cannot regrow (once per callbacks object)', () => {
        // Infinity + Odyssey each defined onPerfectClear TWICE in the same
        // _getPhysicsCallbacks object literal — the later key silently shadowed
        // the first, muting perfect-clear SFX in both modes for months. Pin:
        // at most one occurrence inside the physics-callbacks method body.
        for (const mode of ['SinglePlayerMode', 'InfinityMode', 'OdysseyMode', 'LocalMultiplayerMode']) {
            const src = readFileSync(path.join(repoRoot, 'src', 'core', 'game-modes', `${mode}.js`), 'utf8');
            const start = src.search(/_getPhysicsCallbacks\([^)]*\)\s*{/);
            expect(start, `${mode}: _getPhysicsCallbacks not found`).toBeGreaterThan(-1);
            // Method body ends at the next closing brace at 4-space indent.
            const end = src.indexOf('\n    }', start);
            const body = src.slice(start, end === -1 ? undefined : end);
            const count = (body.match(/onPerfectClear:/g) || []).length;
            expect(count, `${mode} _getPhysicsCallbacks defines onPerfectClear ${count}× — a duplicate key shadows the first`).toBeLessThanOrEqual(1);
        }
    });
});

/**
 * MATCH_COMPATIBILITY (src/core/network/match-compatibility.js) is the one number two builds
 * must share to play an online match together. This file pins what the number stands for: the
 * wire formats, the versus rules and the rule fixtures. When one of them changes, the pin test
 * fails and says what to do. The rest covers how the number is read and compared.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    compareMatchCompatibility, LOBBY_COMPATIBILITY_KEY, MATCH_COMPATIBILITY, readMatchCompatibility,
} from '../../src/core/network/match-compatibility.js';
import { BINARY_BODY_FORMAT_VERSION } from '../../src/core/network/binary-encoding.js';
import { CURRENT_ENVELOPE_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '../../src/core/network/protocol-version.js';
import {
    FFA_RESYNC_SIDECAR_GAME_STATE_FIELDS, FFA_RESYNC_SIDECAR_VERSION,
} from '../../src/core/multiplayer/ffa/resync-sidecar.js';

/**
 * The versus rules every client plays an online match by. Each client simulates its own board
 * with its own build's copy of these, so two builds that differ here play out of sync.
 */
const VERSUS_RULE_FILES = [
    'src/core/multiplayer/versus-rules.js',
    'src/core/multiplayer/ffa-attack-router.js',
    'src/core/multiplayer/frag-tracker.js',
    'src/core/multiplayer/hot-potato.js',
    'src/core/multiplayer/match-level-rule.js',
    'src/core/multiplayer/ffa/garbage-insert.js',
    'src/core/multiplayer/ffa/garbage-helpers.js',
    'src/core/multiplayer/ffa/respawn.js',
    'src/core/multiplayer/ffa/board-helpers.js',
    'src/core/garbage.js',
    'src/core/blind.js',
];
/** The hand-computed pins of the core rules (scoring, levels, garbage mapping). */
const RULE_FIXTURE_FILES = ['tests/unit/golden-rule-fixtures.test.js'];

/** @param {string} path a path from the repository root */
const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

/**
 * Source text without its comments and with whitespace runs collapsed, so a comment or a
 * re-indent does not change the digest and any change to the code does.
 * @param {string} source
 */
function codeOnly(source) {
    let out = '';
    /** @type {string | null} */
    let quote = null;
    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];
        const next = source[i + 1];
        if (quote) {
            out += char;
            if (char === '\\') { out += next ?? ''; i += 1; } else if (char === quote) quote = null;
        } else if (char === '/' && next === '/') {
            while (i < source.length && source[i] !== '\n') i += 1;
            out += '\n';
        } else if (char === '/' && next === '*') {
            i = source.indexOf('*/', i + 2);
            if (i < 0) break;
            i += 1;
        } else {
            if (char === '\'' || char === '"' || char === '`') quote = char;
            out += char;
        }
    }
    return out.replace(/\s+/g, ' ').trim();
}

/** @param {string[]} files */
function digest(files) {
    const hash = createHash('sha256');
    for (const file of files) hash.update(`${file}\n${codeOnly(read(file))}\n`);
    return hash.digest('hex').slice(0, 16);
}

/** What MATCH_COMPATIBILITY stands for in this build. */
function current() {
    return {
        compatibility: MATCH_COMPATIBILITY,
        bodyFormat: BINARY_BODY_FORMAT_VERSION,
        envelope: CURRENT_ENVELOPE_VERSION,
        protocols: [...SUPPORTED_PROTOCOL_VERSIONS],
        sidecarVersion: FFA_RESYNC_SIDECAR_VERSION,
        sidecarFields: createHash('sha256')
            .update([...FFA_RESYNC_SIDECAR_GAME_STATE_FIELDS].sort().join(','))
            .digest('hex').slice(0, 16),
        versusRules: digest(VERSUS_RULE_FILES),
        ruleFixtures: digest(RULE_FIXTURE_FILES),
    };
}

/**
 * The pin. To change it, first decide whether a build WITHOUT your change can still play an
 * online match with a build that has it:
 *   - No (a wire format, a versus rule or a core rule changed how a match plays): raise
 *     MATCH_COMPATIBILITY in src/core/network/match-compatibility.js, then copy the new values
 *     from the failing test's "received" object here.
 *   - Yes (a refactor, a log line, a rename): keep the number and copy the new digests here.
 */
const PINNED = {
    compatibility: 1,
    bodyFormat: 8,
    envelope: 1,
    protocols: ['1.0.0', '2.0.0'],
    sidecarVersion: 1,
    sidecarFields: '74f258d1d2b88e25',
    versusRules: '8a97e77038dfa9be',
    ruleFixtures: '9b08f8be44d04a50',
};

describe('the match compatibility number', () => {
    it('is raised when the wire formats or the rules of an online match change', () => {
        expect(current(), [
            'What an online match is made of changed: a wire format, the versus rules or the rule fixtures.',
            'If a build without this change can no longer play a match with one that has it, raise',
            'MATCH_COMPATIBILITY in src/core/network/match-compatibility.js. Either way, copy the values',
            'below into PINNED in tests/unit/match-compatibility.test.js.',
        ].join('\n')).toEqual(PINNED);
    });

    it('digests code, not comments or layout', () => {
        const before = 'const a = 1; // one\n/** doc */\nexport function f() {\n    return \'// kept\';\n}\n';
        const after = '/* moved */ const a = 1;\nexport function f() { return \'// kept\'; }';
        expect(codeOnly(before)).toBe(codeOnly(after));
        expect(codeOnly(before)).toContain('\'// kept\'');
        expect(codeOnly('const a = 1;')).not.toBe(codeOnly('const a = 2;'));
    });

    it('reads a number from lobby data or a handshake, and nothing else', () => {
        expect(readMatchCompatibility(3)).toBe(3);
        expect(readMatchCompatibility('3')).toBe(3);
        for (const junk of [undefined, null, 0, -1, 1.5, '', '03x', '1e3', ' 2', NaN, Infinity, {}, [2], true]) {
            expect(readMatchCompatibility(junk)).toBe(null);
        }
    });

    it('calls a build that sends no number older', () => {
        expect(compareMatchCompatibility(MATCH_COMPATIBILITY)).toBe('same');
        expect(compareMatchCompatibility(String(MATCH_COMPATIBILITY))).toBe('same');
        expect(compareMatchCompatibility(MATCH_COMPATIBILITY + 1)).toBe('newer');
        expect(compareMatchCompatibility(undefined)).toBe('older');
        expect(compareMatchCompatibility('junk')).toBe('older');
        expect(compareMatchCompatibility(4, 5)).toBe('older');
    });

    it('is published under a lobby data key the main process reads back', () => {
        // electron/steam-integration.js reads the literal key for the match list.
        expect(LOBBY_COMPATIBILITY_KEY).toBe('compat');
        expect(read('electron/steam-integration.js')).toContain(`l.getData('${LOBBY_COMPATIBILITY_KEY}')`);
    });
});

// Audit OD-14: every `odyssey*` flag is read at a hardcoded-default call site
// (URL/localStorage idioms local to OdysseyMode / OdysseyBoardController /
// LevelNodeManager), never through readFlag(), so the registry defaults in
// src/core/flags.js are documentation that can silently drift from code.
//
// This test pins registry default == call-site default WITHOUT rerouting the
// Odyssey reads through readFlag() (the audit explicitly allows the test-only
// remediation; rerouting is a startup-path behavior change out of scope here).
//
// How it works: for each odyssey* registry flag, a descriptor names the source
// file that owns the call site, a pattern that proves the call-site idiom
// still derives the expected default, and that expected default. The test
// fails when:
//   - someone flips a registry default without changing the call site
//     (default mismatch), OR
//   - someone rewrites/moves/removes the call site (pattern no longer
//     matches — update the descriptor AND the registry together), OR
//   - a new odyssey* flag lands in the registry without a descriptor here.
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { FLAG_REGISTRY } from '../../src/core/flags.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourceCache = new Map();
function readSource(relPath) {
    if (!sourceCache.has(relPath)) {
        sourceCache.set(relPath, readFileSync(path.join(ROOT, relPath), 'utf8'));
    }
    return sourceCache.get(relPath);
}

const ODYSSEY_MODE = 'src/core/game-modes/OdysseyMode.js';
const BOARD_CONTROLLER = 'src/rendering/odyssey/OdysseyBoardController.js';
const LEVEL_NODE_MANAGER = 'src/rendering/odyssey/LevelNodeManager.js';

/** `readBooleanUrlFlag('<name>')` returns true ONLY for =1/=true → absent
 * flag defaults to false (OdysseyBoardController.js). */
function optInBoolean(name, file = BOARD_CONTROLLER) {
    return {
        file,
        callSiteDefault: false,
        pattern: new RegExp(`readBooleanUrlFlag\\('${name}'\\)`),
        idiom: `readBooleanUrlFlag('${name}') — absent → false`,
    };
}

/** `.get('<name>')` checked against '0'/'false'/'off' with a `return true` /
 * proceed-by-default fall-through → absent flag defaults to true. */
function optOutBoolean(name, file, pattern) {
    return {
        file,
        callSiteDefault: true,
        pattern,
        idiom: `.get('${name}') === '0'|'false'|'off' opt-out — absent → true`,
    };
}

const CALL_SITES = {
    odysseyKeepBoard: optOutBoolean(
        'odysseyKeepBoard',
        ODYSSEY_MODE,
        /get\('odysseyKeepBoard'\);[\s\S]{0,120}?raw === '0' \|\| raw === 'false' \|\| raw === 'off'[\s\S]{0,220}?return true;/,
    ),
    odysseyChapterEvict: optInBoolean('odysseyChapterEvict'),
    odysseyCoreInstanced: optOutBoolean(
        'odysseyCoreInstanced',
        LEVEL_NODE_MANAGER,
        // Browser default true (the registry documents runtime behavior); the
        // `typeof window === 'undefined'` false branch is a tests/SSR
        // determinism carve-out, not the product default.
        /get\('odysseyCoreInstanced'\);[\s\S]{0,120}?raw === '0' \|\| raw === 'false' \|\| raw === 'off'[\s\S]{0,120}?return true;/,
    ),
    odysseySerialInit: {
        file: BOARD_CONTROLLER,
        callSiteDefault: false,
        pattern: /get\('odysseySerialInit'\) === '1'/,
        idiom: "get('odysseySerialInit') === '1' — absent → false",
    },
    odysseyFastStartOff: optInBoolean('odysseyFastStartOff'),
    odysseyBgWarm: optOutBoolean(
        'odysseyBgWarm',
        BOARD_CONTROLLER,
        /get\('odysseyBgWarm'\);[\s\S]{0,160}?v === '0' \|\| v === 'false' \|\| v === 'off'/,
    ),
    odysseyDomeCullOff: optInBoolean('odysseyDomeCullOff'),
    odysseyLightsFirst: optInBoolean('odysseyLightsFirst'),
    odysseyEagerWindowOff: optInBoolean('odysseyEagerWindowOff'),
    odysseyWarpPreinit: {
        file: ODYSSEY_MODE,
        callSiteDefault: 'defer',
        pattern: /get\('odysseyWarpPreinit'\);[\s\S]{0,400}?return 'defer';/,
        idiom: "_resolveWarpPreinitMode() — absent/invalid → 'defer'",
    },
};

const odysseyFlags = FLAG_REGISTRY.filter((flag) => flag.name.startsWith('odyssey'));

describe('odyssey flag registry drift (OD-14)', () => {
    it('covers every odyssey* registry flag with a call-site descriptor', () => {
        const registryNames = odysseyFlags.map((flag) => flag.name).sort();
        const descriptorNames = Object.keys(CALL_SITES).sort();
        // Fails when a new odyssey* flag lands in the registry without a
        // descriptor here, or a descriptor outlives its registry entry.
        expect(descriptorNames).toEqual(registryNames);
    });

    it.each(odysseyFlags.map((flag) => [flag.name, flag]))(
        '%s: registry default matches the hardcoded call-site default',
        (name, flag) => {
            const site = CALL_SITES[name];
            expect(site, `no call-site descriptor for ${name}`).toBeTruthy();

            const source = readSource(site.file);
            // Pattern failure = the call site was rewritten, moved, or removed.
            // Re-derive its default, then update this descriptor AND the
            // registry entry in src/core/flags.js together.
            expect(
                site.pattern.test(source),
                `${site.file} no longer matches the pinned idiom for ${name} (${site.idiom})`,
            ).toBe(true);

            expect(
                flag.default,
                `registry default for ${name} drifted from its call site in ${site.file} (${site.idiom})`,
            ).toBe(site.callSiteDefault);
        },
    );

    it('keeps the odyssey* namespace on documented local readers', () => {
        // The registry annotates every odyssey flag reader as 'local' today.
        // If a flag migrates to readFlag() (reader: 'flags'), its hardcoded
        // call-site default disappears — remove its descriptor above and let
        // the registry become authoritative for it.
        for (const flag of odysseyFlags) {
            expect(flag.reader, `${flag.name} migrated readers — update this drift test`).toBe('local');
        }
    });
});

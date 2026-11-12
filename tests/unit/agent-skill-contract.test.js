/**
 * The webgpu-threejs-tsl skill's contract with the code it describes.
 *
 * Agents read the skill before writing any shader, and they trust it. A stale reference is worse
 * than none: in 2026-10 an orphan copy stamped three r181 was still telling agents that
 * `THREE.RenderPipeline` did not exist, and by 2026-11 the entry point had grown to 160 KB (every
 * hard-won gotcha in one table), all of it loaded on every use. This test holds what a machine
 * can check, so the rest may be trusted:
 *
 *   - the skill is stamped with the three version that is installed and pinned (ADR-0018: the
 *     skill is re-verified and re-stamped in the bump commit);
 *   - SKILL.md stays a map: small, and with no gotcha rows (those live in gotchas/<topic>.md);
 *   - every name the skill imports from three/tsl, three/webgpu or three/addons exists in the
 *     installed package;
 *   - the gotcha files are well formed: one row per line, four cells, a unique permanent id from
 *     the file's own block, every file listed, every "#NN" cited somewhere naming a real row;
 *   - every repo path the routing pages point at exists.
 *
 * The checks live in the skill itself (`scripts/audit.mjs`), so `node <that file>` prints the
 * same findings, plus the "soft" ones this test leaves alone: precedent files named in gotcha
 * rows. A theme may be rebuilt without touching the skill, so those are reported, not failed.
 *
 * The byte-for-byte mirror for Codex and Antigravity is agent-skill-mirror.test.js.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
    SKILL_BUDGET, auditApi, auditGotchas, auditPaths, auditSize, auditStamp,
} from '../../.claude/skills/webgpu-threejs-tsl/scripts/audit.mjs';

const list = (problems) => (problems.length ? `\n  - ${problems.join('\n  - ')}\n` : '');

describe('agent skill contract (webgpu-threejs-tsl)', () => {
    it('is stamped with the installed, pinned three version', () => {
        const stamp = auditStamp();
        expect(stamp.problems, list(stamp.problems)).toEqual([]);
        expect(stamp.pinned).toBe(stamp.installed);
    });

    it('keeps SKILL.md a map: within its size budget and free of gotcha rows', () => {
        const size = auditSize();
        expect(size.problems, list(size.problems)).toEqual([]);
        expect(size.lines).toBeLessThanOrEqual(SKILL_BUDGET.lines);
        expect(size.bytes).toBeLessThanOrEqual(SKILL_BUDGET.bytes);
    });

    describe('API names', () => {
        let api;
        beforeAll(async () => {
            api = await auditApi();
        }, 60000);

        it('imports only names the installed three exports', () => {
            expect(api.problems, list(api.problems)).toEqual([]);
        });

        it('actually checked the skill (a broken scan would pass everything)', () => {
            expect(api.checked).toBeGreaterThan(300);
        });
    });

    describe('gotcha files', () => {
        const gotchas = auditGotchas();

        it('are well formed: one row per line, four cells, unique ids from the right block', () => {
            expect(gotchas.problems, list(gotchas.problems)).toEqual([]);
        });

        it('still hold every row (a row is never deleted, only corrected in place)', () => {
            // 199 rows at the split of 2026-11. Raise this when rows are added; a drop means lost knowledge.
            expect(gotchas.rows.length).toBeGreaterThanOrEqual(199);
        });

        it('keep the ids the theme docs already cite', () => {
            const byId = new Map(gotchas.rows.map((row) => [row.id, row]));
            // docs/theme-concepts/ cites these by number; the words pin each id to its row.
            const cited = [
                [63, 'PostProcessing'],
                [64, 'is not defined'],
                [80, 'takes seconds to compile'],
                [89, 'addToStack'],
                [94, 'black'],
                [99, 'Vertex buffer count'],
                [102, 'uniformArray'],
                [135, 'lower tiers'],
                [144, 'under the piece'],
                [147, 'phone'],
                [159, 'four rounded cubes'],
            ];
            for (const [id, words] of cited) {
                expect(byId.get(id)?.symptom ?? '', `gotcha #${id}`).toContain(words);
            }
        });
    });

    it('points only at repo files that exist, on its routing pages', () => {
        const paths = auditPaths();
        expect(paths.hard, list(paths.hard)).toEqual([]);
        expect(paths.checked).toBeGreaterThan(100);
    });
});

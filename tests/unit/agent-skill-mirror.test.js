/**
 * Agent skill mirror (ADR-0018: the skill carries a version stamp "so no agent
 * reads the previous version's rules against the new one").
 *
 * The webgpu-threejs-tsl skill is committed twice on purpose: Claude Code loads
 * `.claude/skills/`, Codex and Antigravity load `.agents/skills/`. Nothing kept
 * the copies honest — an orphan third copy (`.agents/webgpu-threejs-tsl/`,
 * still stamped three r181) sat in the tree until 2026-10 telling agents that
 * `THREE.RenderPipeline` did not exist. This test pins the layout:
 *
 *   - `.claude/skills/webgpu-threejs-tsl/` is the copy you edit;
 *   - `.agents/skills/webgpu-threejs-tsl/` is its byte-for-byte mirror;
 *   - no other copy exists.
 *
 * Procedure: docs/WEBGPU_THREEJS_WORKFLOW.md ("Updating the skill").
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SOURCE_DIR = '.claude/skills/webgpu-threejs-tsl';
const MIRROR_DIR = '.agents/skills/webgpu-threejs-tsl';
const ORPHAN_DIR = '.agents/webgpu-threejs-tsl';

// OS droppings are not skill content.
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db']);

function listFiles(relativeDir) {
    const root = path.join(repoRoot, relativeDir);
    const files = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (IGNORED_NAMES.has(entry.name)) continue;
            const absolutePath = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(absolutePath);
            else files.push(path.relative(root, absolutePath).replace(/\\/g, '/'));
        }
    };
    walk(root);
    return files.sort();
}

describe('agent skill mirror (webgpu-threejs-tsl)', () => {
    it('both copies exist and carry the skill entry point', () => {
        for (const dir of [SOURCE_DIR, MIRROR_DIR]) {
            expect(existsSync(path.join(repoRoot, dir, 'SKILL.md')), `${dir}/SKILL.md is missing`).toBe(true);
        }
    });

    it('the .agents mirror holds exactly the files of the .claude source', () => {
        expect(
            listFiles(MIRROR_DIR),
            `${MIRROR_DIR} must mirror ${SOURCE_DIR} — copy the edited skill across`,
        ).toEqual(listFiles(SOURCE_DIR));
    });

    it('every mirrored file is byte-identical', () => {
        const drifted = listFiles(SOURCE_DIR).filter((file) => {
            const mirrorPath = path.join(repoRoot, MIRROR_DIR, file);
            if (!existsSync(mirrorPath)) return true;
            return !readFileSync(path.join(repoRoot, SOURCE_DIR, file)).equals(readFileSync(mirrorPath));
        });
        expect(
            drifted,
            `edit ${SOURCE_DIR}, then copy the same bytes to ${MIRROR_DIR}`,
        ).toEqual([]);
    });

    it('no orphan copy exists outside the two discovery paths', () => {
        expect(
            existsSync(path.join(repoRoot, ORPHAN_DIR)),
            `${ORPHAN_DIR} is loaded by no tool and goes stale — delete it`,
        ).toBe(false);
    });
});

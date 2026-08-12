import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LevelNodeManager } from '../../src/rendering/odyssey/LevelNodeManager.js';

/**
 * WAVE 7 PREREQUISITE — the measuring instrument must not lie.
 *
 * Two defects made every Odyssey GPU number suspect, and both are the kind that produce
 * plausible output rather than an error:
 *
 *  1. STICKY TIMESTAMP. three's `Info.reset()` clears drawCalls/triangles but deliberately
 *     NOT `render.timestamp` (only `dispose()` does). The board read that field once per
 *     FRAME and pushed unconditionally, so a "600 sample" window was one resolved value
 *     repeated for however many frames it dwelled. A slower lane resolves less often, so its
 *     samples are weighted more heavily — a p50 bias no post-processing can undo.
 *
 *  2. THE LEVEL-NODE A/B MEASURED THE SAME FRAME TWICE. `setAllVisible` omitted
 *     `innerCoreMesh` — 60,720 of 190,740 triangles and the only opaque, depth-writing part
 *     — and `?odysseyHideLevelNodes=1` was read only inside the profiler, so on its own it
 *     did nothing at all.
 *
 * The sampling fix is asserted against SOURCE because exercising it needs a WebGPU device
 * and a resolved query; what must not regress is the shape (push inside the resolve
 * handler, in-flight guard, epoch guard) rather than any value.
 */

const ROOT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '../..',
);
const BOARD = readFileSync(
    path.join(ROOT, 'src/rendering/odyssey/OdysseyBoardController.js'),
    'utf8',
);

describe('GPU profile sampling records once per RESOLVED query', () => {
    it('does not push a ring sample from the per-frame sampler', () => {
        const fn = BOARD.slice(BOARD.indexOf('_sampleGpuProfile() {'));
        const body = fn.slice(0, fn.indexOf('\n    }'));
        expect(body).not.toMatch(/gpuProfileRing\.push/);
    });

    it('pushes inside the resolve handler, guarded by in-flight and epoch checks', () => {
        const fn = BOARD.slice(BOARD.indexOf('_resolveRenderTimestamps() {'));
        const body = fn.slice(0, fn.indexOf('\n    }'));
        expect(body).toMatch(/resolveTimestampsAsync\([^)]*\)\s*\n?\s*\.then\(/);
        expect(body).toMatch(/gpuProfileRing\.push\(ts\)/);
        expect(body).toMatch(/if \(this\._gpuTimestampPending\) return;/);
        expect(body).toMatch(/epoch === this\._gpuTimestampEpoch/);
        expect(body).toMatch(/\.finally\(\(\) => \{ this\._gpuTimestampPending = false; \}\)/);
    });

    it('bumps the epoch on ring reset, so a settle-phase resolve cannot enter the window', () => {
        const reset = BOARD.slice(BOARD.indexOf('window.__ODYSSEY_GPU_RESET__'));
        expect(reset.slice(0, 700)).toMatch(/_gpuTimestampEpoch \+= 1/);
    });
});

describe('the level-node A/B actually hides the level nodes', () => {
    /** A manager with the mesh handles the A/B toggles, without a WebGPU device. */
    function managerWithMeshes() {
        const m = Object.create(LevelNodeManager.prototype);
        m.glassInstancedMesh = { visible: true };
        m.glowInstancedMesh = { visible: true };
        m.lockInstancedMesh = { visible: true };
        m.starInstancedMesh = { visible: true };
        m.particleSystem = { visible: true };
        m.innerCoreMesh = { visible: true };
        m.nodes = new Map([[1, { group: { visible: true } }]]);
        m._forcedHidden = false;
        return m;
    }

    it('hides the opaque inner core too — 31.8% of the group, and the only depth-writer', () => {
        const m = managerWithMeshes();
        m.setAllVisible(false);
        expect(m.innerCoreMesh.visible).toBe(false);
        [m.glassInstancedMesh, m.glowInstancedMesh, m.lockInstancedMesh,
            m.starInstancedMesh, m.particleSystem].forEach((mesh) => {
            expect(mesh.visible).toBe(false);
        });
        expect([...m.nodes.values()][0].group.visible).toBe(false);
    });

    it('latches, so the per-frame visibility write cannot re-show the group', () => {
        const m = managerWithMeshes();
        m.setAllVisible(false);
        expect(m._forcedHidden).toBe(true);
        m.setAllVisible(true);
        expect(m._forcedHidden).toBe(false);
        expect(m.innerCoreMesh.visible).toBe(true);
    });

    it('the per-frame write in update() consults the latch', () => {
        const src = readFileSync(
            path.join(ROOT, 'src/rendering/odyssey/LevelNodeManager.js'),
            'utf8',
        );
        const idx = src.indexOf('node.group.visible = isVisible;');
        expect(idx).toBeGreaterThan(-1);
        expect(src.slice(Math.max(0, idx - 500), idx)).toMatch(/!this\._forcedHidden/);
    });

    it('applies ?odysseyHideLevelNodes at node creation, not only inside the profiler', () => {
        // The flag used to be consumed exclusively by _sampleGpuProfile, so without
        // ?odysseyGpuProfile=1 it did nothing and a hand-run A/B compared identical frames.
        const createIdx = BOARD.indexOf('await this.nodeManager.createNodes(');
        expect(createIdx).toBeGreaterThan(-1);
        const after = BOARD.slice(createIdx, createIdx + 900);
        expect(after).toMatch(/if \(this\.hideLevelNodes\) this\.nodeManager\.setAllVisible\(false\)/);
    });
});

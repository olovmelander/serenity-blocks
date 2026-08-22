import {
    describe, expect, it, vi,
} from 'vitest';
import { createEarthCoreEnvironment } from '../../src/rendering/odyssey/chapter-environments/earth-core.js';

function stubCanvasDocument() {
    const gradient = { addColorStop: vi.fn() };
    const context = {
        clearRect: vi.fn(),
        createRadialGradient: vi.fn(() => gradient),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
    };
    vi.stubGlobal('document', {
        createElement: vi.fn(() => ({ width: 0, height: 0, getContext: vi.fn(() => context) })),
    });
}

// Wave 3b's instrument AND its ratchet. The inventory found 77 drawables (65 meshes + 12
// sprites); merging the 20 contact-shadow decals — the largest family, shared-material,
// static, uv()-only shading — took it to 58 and the in-game station from ~127 to 90 draws.
// The ceiling below pins that win: adding a drawable family without consolidating an old one
// fails here, loudly, instead of drifting back toward the 131-draw chapter this plan measured.
// Lowered 58 -> 56 -> 55 as Wave 3b's fill pass deleted the horizon dupes, then folded the canopy shell into the background shader.
// on Lane B at 57 ms.
describe('earth-core drawable budget (Wave 3b ratchet)', () => {
    it('counts drawables by family', () => {
        stubCanvasDocument();
        const group = createEarthCoreEnvironment({ qualityName: 'High' });
        const fam = {};
        let meshes = 0; let sprites = 0; let instanced = 0; const materials = new Set();
        group.traverse((o) => {
            if (o.isSprite) sprites += 1;
            else if (o.isInstancedMesh) instanced += 1;
            else if (o.isMesh) meshes += 1;
            else return;
            const key = (o.name || o.parent?.name || 'unnamed').replace(/[-\d]+$/, '');
            fam[key] = (fam[key] || 0) + 1;
            if (o.material) [].concat(o.material).forEach((m) => materials.add(m.uuid));
        });
        console.log(
            `TOTAL drawables: meshes=${meshes} sprites=${sprites} `
            + `instanced=${instanced} materials=${materials.size}`,
        );
        Object.entries(fam).sort((a, b) => b[1] - a[1])
            .forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));
        expect(meshes + sprites + instanced, 'drawable ceiling — consolidate before adding').toBeLessThanOrEqual(55);
        expect(meshes + sprites + instanced).toBeGreaterThan(0);
        // MATERIAL ceiling (2026-08-22). Chapter 1's pre-reveal compile barrier measures ~1,900 ms
        // over these materials — ~76-90 ms EACH, of which only ~4-6 ms is main-thread node building
        // (~125 nodes/ms). The rest is per-material fixed cost: bind groups, pipeline descriptor,
        // WGSL assembly, DXC scheduling. So the count is the lever, not graph size — sharing the
        // chapel's molten pocket with the six node pockets (26 -> 25) measured -91 ms on ch1 and
        // -98 ms on cold startup, while a 40 % node-count reduction was worth an estimated ~10 ms.
        // Share an existing material before adding a new one.
        expect(materials.size, 'material ceiling — each one is ~90 ms of the reveal').toBeLessThanOrEqual(25);
    });
});

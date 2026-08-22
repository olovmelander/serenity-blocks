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
        // MATERIAL ceiling (2026-08-23). Chapter 1s pre-reveal compile barrier is ~1,850 ms over
        // these materials, and removing one is worth roughly **30 ms of fixed cost plus a term that
        // scales with its graph**: measured, one 903-node material was -90 ms cold and two 15-node
        // sprite materials were -59 ms together (~30 ms each). Main-thread NODE BUILDING is not the
        // driver either way - that runs at ~125 nodes/ms, so 903 nodes is ~7 ms of it; the rest is
        // per-material fixed work (bind groups, pipeline descriptor) plus WGSL assembly and DXC time
        // that grows with the shader. So BOTH count and graph size matter, and the cheapest wins are
        // whole materials that were never distinct in the first place.
        // Ratcheted 26 -> 25 (selenite chapel shares the node pockets molten material) -> 23 (three
        // basin coronas share one sprite material). Share an existing material before adding a new one.
        expect(materials.size, 'material ceiling - each one costs ~30 ms + its graph').toBeLessThanOrEqual(23);
    });
});

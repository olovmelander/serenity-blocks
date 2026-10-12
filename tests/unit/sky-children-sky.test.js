/**
 * Sky Children — the sky's layout on the CPU: the world's cumulus (the storm's tower) placed from the
 * solved frame, the sky's calm zones handed to the dome from the live layout, and the hours' sky
 * numbers as value keys. Relations only (counted, ordered, bounded): no tuning number is pinned.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { REST_RIG, SkyChildrenWorld, fovForAspect } from '../../src/themes/sky-children/sky-children-world.js';
import { QUALITY_NAMES, tierFor } from '../../src/themes/sky-children/sky-children-quality.js';
import { fallbackLayout } from '../../src/themes/sky-children/sky-children-composition.js';
import { project } from '../../src/themes/sky-children/sky-children-frame.js';
import { cumulusPlan } from '../../src/themes/sky-children/sky-children-cumulus.js';
import { HOUR_NAMES, HOUR_SCALARS } from '../../src/themes/sky-children/sky-children-hours.js';

vi.setConfig({ testTimeout: 60_000 });

const worlds = [];
afterEach(() => {
    worlds.splice(0).forEach((w) => w.dispose());
});

function makeWorld(quality, width = 1600, height = 900, layout = fallbackLayout(width, height)) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new SkyChildrenWorld({ scene, quality, capture: true }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.setLayout(layout, aspect);
    return world;
}

/** The puffs the cumulus draw holds: { x, y, z, r, base }. */
function puffsOf(world) {
    const { geometry } = world.parts.cumulus.mesh;
    const data = geometry.getAttribute('iPuff').data.array;
    const { stride } = geometry.getAttribute('iPuff').data;
    return Array.from({ length: geometry.instanceCount }, (_, i) => ({
        x: data[i * stride], y: data[i * stride + 1], z: data[i * stride + 2], r: data[i * stride + 3], base: data[i * stride + 8],
    }));
}

describe('Sky Children sky: the storm tower', () => {
    it('stands one tower on the storm\'s bearing in a landscape frame, clear of the card\'s edge', () => {
        const world = makeWorld('High');
        const clouds = cumulusPlan(world.frame, world.U.shower.value.x);
        const towers = clouds.filter((c) => c.kind === 0);
        expect(towers).toHaveLength(1);
        const [t] = towers;
        const bearing = Math.atan2(t.x, -t.z);
        expect(Math.abs(bearing - world.U.shower.value.x)).toBeLessThan(0.1);
        // Its right flank, half way up, lands left of the card with a margin.
        const len = Math.hypot(t.x, t.z);
        const flank = [t.x + (-t.z / len) * t.W * 0.5, t.y + t.H * 0.5, t.z + (t.x / len) * t.W * 0.5];
        const n = Math.hypot(...flank);
        const p = project(flank.map((v) => v / n), world.frame.cam);
        const card = world.layout.cards[0];
        expect(p.front).toBe(true);
        expect(p.x).toBeLessThan(card.x0 - 0.005);
    });

    it.each(QUALITY_NAMES)('fills the cumulus draw within its capacity at %s, sorted back to front on flat bases', (quality) => {
        const world = makeWorld(quality);
        const puffs = puffsOf(world);
        const capacity = tierFor(quality).cumulusPuffs;
        expect(puffs.length).toBeGreaterThan(capacity * 0.5);
        expect(puffs.length).toBeLessThanOrEqual(capacity);
        for (let i = 1; i < puffs.length; i++) {
            const a = puffs[i - 1];
            const b = puffs[i];
            expect(Math.hypot(a.x, a.y, a.z)).toBeGreaterThanOrEqual(Math.hypot(b.x, b.y, b.z) - 1e-3);
        }
        // Every head stands on its cloud's base (the shader cuts the base flat there).
        puffs.forEach((q) => expect(q.y).toBeGreaterThanOrEqual(q.base));
    });
});

describe('Sky Children sky: the calm zones', () => {
    it('hands the dome the cards\' union and the HUD as boxes, and none without a layout', () => {
        const world = makeWorld('Low');
        const { calmA, calmB } = world.U;
        // Both boxes have size, and the HUD lies right of the cards (as the layout puts it).
        expect(calmA.value.z).toBeGreaterThan(0);
        expect(calmA.value.w).toBeGreaterThan(0);
        expect(calmB.value.z).toBeGreaterThan(0);
        expect(calmB.value.x).toBeGreaterThan(calmA.value.x);
        world.setLayout(null);
        expect(world.U.calmA.value.z).toBeLessThan(0);
        expect(world.U.calmB.value.z).toBeLessThan(0);
    });
});

describe('Sky Children sky: the hours paint the sky as value keys', () => {
    it('casts the anticrepuscular rays deepest at the rose and gilded hours, all but none at night and dawn', () => {
        const { rays } = HOUR_SCALARS;
        const rose = rays[HOUR_NAMES.findIndex((n) => /rose/i.test(n))];
        const gilded = rays[HOUR_NAMES.findIndex((n) => /gilded/i.test(n))];
        const night = rays[HOUR_NAMES.findIndex((n) => /night/i.test(n))];
        const pearl = rays[HOUR_NAMES.findIndex((n) => /pearl/i.test(n))];
        expect(Math.min(rose, gilded)).toBeGreaterThan(Math.max(...rays.filter((v) => v !== rose && v !== gilded)));
        expect(Math.max(night, pearl)).toBeLessThan(Math.min(rose, gilded) * 0.25);
    });
});

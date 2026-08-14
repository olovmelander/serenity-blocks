/**
 * HERO CUMULUS — placement invariants and gate plumbing.
 *
 * The heroes are OPAQUE geometry with no near-fade anywhere in the shader, which is only safe
 * because the placements guarantee the camera can never enter one. That guarantee has to be
 * MECHANICALLY checked against the live rail, not asserted in a comment — a spec edit that moves
 * a cloud onto the path would otherwise ship a hole in the sky.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildHeroCloudGeometry, validateHeroCloudPlacements } from './odyssey-hero-clouds.js';
import { HERO_CLOUD_RULES, ODYSSEY_HERO_CLOUD_SPECS } from './odyssey-hero-cloud-specs.js';
import { getOdysseyPathPointAt } from '../path-utils.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rendererSource = readFileSync(path.join(HERE, 'odyssey-world-renderer.js'), 'utf8');
// Dense enough that a hero cannot hide between two samples: the rail is ~1,770 u long, so 400
// samples put them ~4.4 u apart against a 600 u clearance rule.
const RAIL = Array.from({ length: 400 }, (_, i) => getOdysseyPathPointAt(i / 399));

describe('hero cloud placements', () => {
    it('keeps every shipped hero legal against the live rail', () => {
        expect(validateHeroCloudPlacements(ODYSSEY_HERO_CLOUD_SPECS, RAIL)).toEqual([]);
    });

    it('ships all six authored heroes', () => {
        expect(ODYSSEY_HERO_CLOUD_SPECS).toHaveLength(6);
    });

    it('clears the deck billow ceiling and the highest eye', () => {
        // Deck plane 660 + billow ~116 = 776; the eye reaches ~672 at the act-gate edge.
        expect(HERO_CLOUD_RULES.MIN_LOBE_Y).toBeGreaterThan(776);
        ODYSSEY_HERO_CLOUD_SPECS.forEach((spec) => {
            expect(spec.base).toBeGreaterThanOrEqual(HERO_CLOUD_RULES.MIN_LOBE_Y);
        });
    });

    it('detects an illegal placement instead of silently accepting it', () => {
        // Falsifies the validator itself — a rule nothing can break is not a rule.
        const onRail = [{
            ...ODYSSEY_HERO_CLOUD_SPECS[0], id: 'BAD', x: RAIL[200].x, z: RAIL[200].z,
        }];
        expect(validateHeroCloudPlacements(onRail, RAIL).length).toBeGreaterThan(0);
    });
});

describe('hero cloud geometry', () => {
    it('builds a merged non-indexed mesh with per-lobe smooth normals', () => {
        const built = buildHeroCloudGeometry(ODYSSEY_HERO_CLOUD_SPECS);
        expect(built.geometry.index).toBeNull();
        expect(built.geometry.getAttribute('position').count).toBeGreaterThan(0);
        expect(built.geometry.getAttribute('normal').count)
            .toBe(built.geometry.getAttribute('position').count);
        expect(built.lobes).toBeGreaterThanOrEqual(ODYSSEY_HERO_CLOUD_SPECS.length * 6);
        // Cheap by design: this must stay noise against the ~756k triangles already submitted.
        expect(built.triangles).toBeLessThan(40000);
    });

    it('is deterministic — the same sky every boot, so captures are reproducible', () => {
        const a = buildHeroCloudGeometry(ODYSSEY_HERO_CLOUD_SPECS).geometry.getAttribute('position');
        const b = buildHeroCloudGeometry(ODYSSEY_HERO_CLOUD_SPECS).geometry.getAttribute('position');
        expect(Array.from(a.array.slice(0, 64))).toEqual(Array.from(b.array.slice(0, 64)));
    });

    it('seats every lobe above the hero base (no lobe hangs below the condensation plane)', () => {
        const built = buildHeroCloudGeometry(ODYSSEY_HERO_CLOUD_SPECS);
        const pos = built.geometry.getAttribute('position').array;
        const minBase = Math.min(...ODYSSEY_HERO_CLOUD_SPECS.map((s) => s.base));
        let lowest = Infinity;
        for (let i = 1; i < pos.length; i += 3) if (pos[i] < lowest) lowest = pos[i];
        // Lobes are spheres seated ON the base plane, so the lowest vertex may dip below the
        // nominal base by up to a primary's squashed radius — but never near the deck.
        expect(lowest).toBeGreaterThan(minBase - 200);
        expect(lowest).toBeGreaterThan(776);
    });
});

describe('hero cloud gating (source-level, the ×0-uniform lesson)', () => {
    it('gates the mesh with a real CPU .visible write', () => {
        // Multiplying by a zero uniform is NOT dead-code-eliminated on this stack, so the gate
        // must be a `.visible` write or the draw is still submitted and shaded.
        expect(rendererSource).toMatch(/heroMesh\.visible\s*=\s*heroes\s*&&/);
    });

    it('keeps the material opaque — the whole sorting argument rests on it', () => {
        // If it ever became transparent it would move to the transparent queue, where
        // renderOrder dominates depth and the mountains would sort wrongly against it.
        expect(rendererSource).not.toMatch(/heroMat\.transparent\s*=/);
        expect(rendererSource).not.toMatch(/heroMat\.opacityNode\s*=/);
        expect(rendererSource).toMatch(/heroMat\.side\s*=\s*THREE\.FrontSide/);
    });

    it('opts the hero material out of scene fog (the 4x-recurring trap)', () => {
        // Asserts MEMBERSHIP, not position. This used to pin `heroMat` as the LAST name in the
        // array, which broke the moment a later material was appended — a brittleness, not a
        // stronger guarantee. The claim being made is "the hero material opts out of scene
        // fog"; that is what is checked now, and `odyssey-world-lints.test.js` separately
        // asserts the list names EVERY constructed material, which is the stronger invariant.
        const fogOptOut = rendererSource.match(/\[([^\]]+)\]\.forEach\(\(m\) => \{ m\.fog = false; \}\)/);
        expect(fogOptOut, 'the fog opt-out forEach must exist').toBeTruthy();
        expect(fogOptOut[1].split(',').map((n) => n.trim())).toContain('heroMat');
    });
});

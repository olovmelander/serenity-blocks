import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ODYSSEY_SUN } from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';

/**
 * WAVE 0.2 — ONE SUN. Two lights inside one composition are the kind of incoherence you feel as
 * "this doesn't look like one place" long before you can point at it.
 */

const ROOT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '../..',
);

describe('Odyssey has one sun', () => {
    it('keeps the canonical sun frozen, so aliasing it cannot be undone by mutation', () => {
        // Sharing one array is only safe while nobody can write to it: a single write would
        // silently move the sun for every consumer in the journey.
        expect(Object.isFrozen(ODYSSEY_SUN)).toBe(true);
    });

    it('keeps ONE declaration of the re-solved world sun, in the import-free leaf', () => {
        // It used to be declared in odyssey-world-renderer.js and imported by nobody — a third
        // sun in waiting. A chapter cannot reasonably import the whole world renderer to find
        // out where the light is, so the declaration belongs in chapter-profile.js and the
        // renderer re-exports it for its own modules.
        const world = readFileSync(
            path.join(ROOT, 'src/rendering/odyssey/world/odyssey-world-renderer.js'),
            'utf8',
        );
        expect(world).not.toMatch(/const ODYSSEY_WORLD_SUN\s*=\s*\[/);
        expect(world).toMatch(/import \{ ODYSSEY_WORLD_SUN \}/);
    });

    it('lights Ch6 hero planet in WORLD space, so the terminator cannot follow the camera', () => {
        // The defect: `dot(normalView, uLightDir)` welds the light to the camera, so the
        // planet's day/night line rotated 11.2 deg end-to-end across the chapter as you flew
        // past it. normalWorld on a sphere is radial and therefore spin-invariant — the belts
        // rotate underneath a terminator that stays put.
        const src = readFileSync(
            path.join(ROOT, 'src/rendering/odyssey/chapter-environments/cosmic-expanse.tsl.js'),
            'utf8',
        );
        expect(src).not.toMatch(/dot\(\s*normalView\s*,\s*normalize\(uLightDir\)\s*\)/);
        expect(src).toMatch(/dot\(\s*normalize\(normalWorld\)\s*,\s*normalize\(uLightDir\)\s*\)/);
        // ...and it is the journey's sun, not another hand-tuned triple.
        expect(src).toMatch(/uniform\(new THREE\.Vector3\(\.\.\.ODYSSEY_WORLD_SUN\)/);
    });
});

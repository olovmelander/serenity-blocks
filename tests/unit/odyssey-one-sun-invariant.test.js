import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ODYSSEY_SUN } from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';
import { MOUNTAIN_SHADING } from '../../src/rendering/odyssey/chapter-environments/shared/mountain-language.js';

/**
 * WAVE 0.2 — ONE SUN.
 *
 * The defect this pins: alpine surfaces were keyed to a hand-tuned `[0.5, 0.8, 0.5]` while
 * everything sharing a frame with them used `ODYSSEY_SUN`. Two lights, 72.5 degrees apart,
 * inside one composition — the kind of incoherence you feel as "this doesn't look like one
 * place" long before you can point at it.
 *
 * These are identity assertions, not value assertions, and that is the whole point. Asserting
 * `keyDir` EQUALS some literal would pass just as happily against a copied constant that has
 * since drifted; asserting it IS the same frozen object cannot. Retuning the sun is still
 * allowed — retuning it in only one of the two places is not.
 */

const ROOT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '../..',
);

/** Angle between two direction vectors, in degrees. */
function angleBetween(a, b) {
    const dot = (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
    const la = Math.hypot(...a);
    const lb = Math.hypot(...b);
    return (Math.acos(Math.max(-1, Math.min(1, dot / (la * lb)))) * 180) / Math.PI;
}

describe('Odyssey has one sun', () => {
    it('keys the alpine language to ODYSSEY_SUN by identity, not by a copied literal', () => {
        expect(Object.is(MOUNTAIN_SHADING.keyDir, ODYSSEY_SUN)).toBe(true);
    });

    it('keeps the canonical sun frozen, so aliasing it cannot be undone by mutation', () => {
        // Sharing one array between shading profiles is only safe while nobody can write to
        // it. Without the freeze, a single `MOUNTAIN_SHADING.keyDir[1] = 0.9` would silently
        // move the sun for every consumer in the journey.
        expect(Object.isFrozen(ODYSSEY_SUN)).toBe(true);
    });

    it('records the split it closed, so a regression reads as a number and not a vibe', () => {
        const OLD_ALPINE_KEY = [0.5, 0.8, 0.5];
        expect(angleBetween(OLD_ALPINE_KEY, ODYSSEY_SUN)).toBeGreaterThan(70);
        expect(angleBetween(MOUNTAIN_SHADING.keyDir, ODYSSEY_SUN)).toBe(0);
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

    it('leaves no second hard-coded key-light direction in the shared alpine language', () => {
        // The override PARAMETER stays — Mountains legitimately aligns the key to its on-screen
        // sun disc, and the winter theme drives it from its own storm state. What must not come
        // back is a module-level literal acting as a default that quietly competes with the sun.
        const src = readFileSync(
            path.join(ROOT, 'src/rendering/odyssey/chapter-environments/shared/mountain-language.js'),
            'utf8',
        );
        const literalKey = /keyDir\s*:\s*\[/;
        expect(src).not.toMatch(literalKey);
    });
});

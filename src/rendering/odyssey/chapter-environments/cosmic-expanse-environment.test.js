import { describe, expect, it } from 'vitest';
import {
    COSMIC_ENTRY_CONTINUITY_SETTINGS,
    createCosmicExpanseEnvironment,
    resolveCosmicEntryContinuity,
    updateCosmicExpanseEnvironment,
} from './cosmic-expanse.js';

describe('Cosmic Expanse chapter environment (creative plan ch6)', () => {
    it('mounts the asteroid garland, star tiers, and streak motes', () => {
        const group = createCosmicExpanseEnvironment({ particleCount: 200 });

        expect(group.userData.asteroids?.name).toBe('asteroid-garland');
        expect(group.userData.asteroids.count).toBe(12);
        expect(group.userData.filamentBridge).toBeUndefined();
        expect(group.userData.starsNear?.name).toBe('void-stars-near');
        expect(group.userData.streakMotes?.name).toBe('cosmic-streak-motes');
    });

    it('stages the chapter entry from carried aurora into uncluttered space', () => {
        const entry = resolveCosmicEntryContinuity(0.05);
        expect(entry.starReveal).toBeGreaterThan(COSMIC_ENTRY_CONTINUITY_SETTINGS.starFloor);
        expect(entry.heroReveal).toBeLessThan(0.02);
        expect(entry.clutterReveal).toBeLessThan(0.02);

        const settledSpace = resolveCosmicEntryContinuity(0.5);
        expect(settledSpace.starReveal).toBeGreaterThan(0.95);
        expect(settledSpace.heroReveal).toBeGreaterThan(0.95);
        expect(settledSpace.clutterReveal).toBeGreaterThan(0.95);
    });

    it('suppresses dense opener clutter until the aurora handoff completes', () => {
        const group = createCosmicExpanseEnvironment({ particleCount: 200 });
        group.userData.chapterOpacity = 1;

        updateCosmicExpanseEnvironment(group, 0.016, 1.0, null, 0.05);
        expect(group.userData.asteroids.material.opacity).toBeLessThan(0.02);
        expect(group.userData.heroPlanet.userData.planet.material.opacity).toBeLessThan(0.05);
        expect(group.userData.starsNear.material.opacity).toBeGreaterThan(0.08);

        updateCosmicExpanseEnvironment(group, 0.016, 2.0, null, 0.55);
        expect(group.userData.asteroids.material.opacity).toBeGreaterThan(0.95);
        expect(group.userData.heroPlanet.userData.planet.material.opacity).toBeGreaterThan(0.95);
    });

    it('marches the black hole along the rail vanishing point (up-right)', () => {
        const group = createCosmicExpanseEnvironment({ particleCount: 200 });
        const { blackHole } = group.userData;

        // Entry pose: near-centre, low.
        updateCosmicExpanseEnvironment(group, 0.016, 1.0, null, 0);
        const entryX = blackHole.position.x;
        const entryY = blackHole.position.y;

        // Seam pose: the hole has led +X (the rail's vanishing point) and risen — the
        // up-right half of frame is never empty (the dead-air fix).
        updateCosmicExpanseEnvironment(group, 0.016, 2.0, null, 1);
        expect(blackHole.position.x).toBeGreaterThan(entryX + 80);
        expect(blackHole.position.y).toBeGreaterThan(entryY + 50);
        expect(blackHole.scale.x).toBeGreaterThan(2.5);
    });

    it('tumbles the asteroids without losing their stations', () => {
        const group = createCosmicExpanseEnvironment({ particleCount: 200 });
        const { asteroids } = group.userData;
        expect(asteroids.userData.seats.length).toBe(36);
        expect(asteroids.userData.spins.length).toBe(36);

        // The update must flag the instance matrices for re-upload (the tumble).
        // needsUpdate is a setter-only property that bumps the attribute version.
        const versionBefore = asteroids.instanceMatrix.version;
        updateCosmicExpanseEnvironment(group, 0.016, 5.0, null, 0.5);
        expect(asteroids.instanceMatrix.version).toBeGreaterThan(versionBefore);
    });
});

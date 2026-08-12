import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
    COSMIC_ENTRY_CONTINUITY_SETTINGS,
    createCosmicExpanseEnvironment,
    resolveCosmicEntryContinuity,
    resolveSummitEarthStaging,
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

    it('keeps the black hole ahead down the corridor and looming', () => {
        const group = createCosmicExpanseEnvironment({ particleCount: 200 });
        const { blackHole } = group.userData;
        const { forward, origin } = group.userData.corridorFrame;
        const ahead = (v) => v.clone().sub(origin).dot(forward);
        const range = (v) => v.distanceTo(origin);

        updateCosmicExpanseEnvironment(group, 0.016, 1.0, null, 0);
        const entry = blackHole.position.clone();
        const entryScale = blackHole.scale.x;

        updateCosmicExpanseEnvironment(group, 0.016, 2.0, null, 1);

        // The omen stays AHEAD of the camera down the corridor for the whole chapter and
        // closes in. Deliberately not asserted along world +Y (as this test once did):
        // chapter 6 climbs while its aim flattens 33 deg -> 15 deg, so a hero whose world
        // Y rose with the camera would drift out of the top of frame. Screen placement is
        // what matters and it is solved in APPROACH — the hole holds the upper-left third
        // at ndc y +0.19 -> +0.42, guarded by the corridor test below.
        expect(ahead(entry)).toBeGreaterThan(400);
        expect(ahead(blackHole.position)).toBeGreaterThan(400);
        expect(range(blackHole.position)).toBeLessThan(range(entry));
        expect(blackHole.position.x).toBeGreaterThan(entry.x + 80);
        expect(blackHole.scale.x).toBeGreaterThan(entryScale * 2);
        expect(blackHole.scale.x).toBeGreaterThan(2.5);
    });

    it('solves the hero triad onto the chapter corridor rather than off-frame', () => {
        // Regression guard for the framing bug: the triad used to be authored as if the
        // corridor ran -Z, leaving the heroes 31-68 deg off a ~49 deg half-FOV forward ray
        // (the gas giant reached ndcX -1.00 by p=0.68). Assert each hero sits within the
        // frustum's angular reach of the corridor axis at BOTH march endpoints.
        const group = createCosmicExpanseEnvironment({ particleCount: 200 });
        const { forward, origin } = group.userData.corridorFrame;
        const { blackHole, heroPlanet, galaxy } = group.userData;

        const offAxis = (object) => THREE.MathUtils.radToDeg(
            object.position.clone().sub(origin).angleTo(forward),
        );

        [0, 1].forEach((progress) => {
            updateCosmicExpanseEnvironment(group, 0.016, 1.0, null, progress);
            [blackHole, heroPlanet, galaxy].forEach((hero) => {
                expect(offAxis(hero)).toBeLessThan(40);
            });
        });
    });

    // ── EARTH AT THE SUMMIT (ask: "see the earth before it gets dark") ──────────────
    describe('earth-at-summit staging', () => {
        // Live chapter boundaries; the Space backdrop fade begins at ch6Start and the
        // bright Ch5 dome is hard-gated off by ~ch6Start + 0.018.
        const CH5 = 0.556;
        const CH6 = 0.648;
        const CH7 = 0.815;
        const stage = (p) => resolveSummitEarthStaging(p, CH5, CH6, CH7);

        it('reveals the earth while the Ch5 sky is still bright', () => {
            // Nothing at the start of Ch5...
            expect(stage(0.58).earthReveal).toBe(0);
            // ...rising as the camera crests the summit...
            expect(stage(0.622).earthReveal).toBeGreaterThan(0.15);
            // ...and FULLY present before the boundary, i.e. before the dome fade even
            // begins. This is the whole point: the windows used to be disjoint.
            expect(stage(0.636).earthReveal).toBeGreaterThan(0.99);
            expect(0.636).toBeLessThan(CH6);
        });

        it('never lets the earth drop back out once space darkens', () => {
            const samples = [0.64, CH6, 0.66, 0.70, 0.78, 0.81];
            samples.forEach((p) => expect(stage(p).earthReveal).toBeGreaterThan(0.99));
        });

        it('holds the rest of Space out of the daylight frame', () => {
            // Through the whole summit reveal window the space gate is shut, so stars,
            // the black hole, the nebula and the void dome cannot leak into the bright
            // sky (the "do not re-wash space" constraint runs the other way too).
            [0.612, 0.622, 0.636, 0.6479].forEach((p) => {
                expect(stage(p).spaceReveal).toBe(0);
            });
            // It opens only once the camera is actually past the boundary.
            expect(stage(0.652).spaceReveal).toBeGreaterThan(0);
            expect(stage(0.652).spaceReveal).toBeLessThan(1);
            expect(stage(0.66).spaceReveal).toBe(1);
        });

        it('leaves progress outside the summit window untouched', () => {
            // Below the window the manager keeps the chapter at zero opacity anyway, and
            // headless callers pass a chapter-local progress here — both must behave as
            // they did before the gate existed.
            expect(stage(0.05).spaceReveal).toBe(1);
            expect(stage(0.5).spaceReveal).toBe(1);
            expect(stage(0.9).spaceReveal).toBe(1);
        });

        it('degrades safely without a resolved layout', () => {
            expect(resolveSummitEarthStaging(0.62, undefined, undefined, undefined))
                .toEqual({ earthReveal: 0, spaceReveal: 1, summitStart: Number.NaN });
        });

        it('shows the gas giant but nothing else during the summit window', () => {
            const group = createCosmicExpanseEnvironment({ particleCount: 200 });
            group.userData.chapterOpacity = 1;
            // Camera is null here, so `approach` falls back to the progress value — which
            // is exactly the pre-boundary case: chapter-local reveals are all still 0.
            updateCosmicExpanseEnvironment(group, 0.016, 1.0, null, 0.638);

            expect(group.userData.heroPlanet.userData.planet.material.opacity)
                .toBeGreaterThan(0.95);
            expect(group.userData.starsNear.material.opacity).toBeLessThan(0.01);
            expect(group.userData.galaxy.material.opacity).toBeLessThan(0.01);
            expect(group.userData.nebulaVolume.material.opacity).toBeLessThan(0.01);
            expect(group.userData.auroraBridge.visible).toBe(false);
            expect(group.userData.voidSky.visible).toBe(false);
            expect(group.userData.diskLight.intensity).toBe(0);
        });
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

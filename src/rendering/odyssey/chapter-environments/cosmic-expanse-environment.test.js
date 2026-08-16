import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { deriveOdysseyChapterPositions } from '../../../core/odyssey/data/odyssey-layout.js';
import {
    COSMIC_ENTRY_CONTINUITY_SETTINGS,
    SUMMIT_EARTH_REVEAL,
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
        // ⚠️ These were HARDCODED as 0.556 / 0.648 / 0.815 and labelled "live chapter
        // boundaries". They were the PRE-ASCENT values, and 0.556 was never a chapter
        // boundary at all — it is level 31, the exact fictional number this repo has
        // already been burned by once. Every probe below was therefore landing in
        // chapter 5, and the suite would have passed whether or not the schedule was
        // right. DERIVED now, and every probe expressed relative to the derived window.
        const positions = deriveOdysseyChapterPositions();
        const CH5 = positions[4];
        const CH6 = positions[5];
        const CH7 = positions[6];
        const stage = (p) => resolveSummitEarthStaging(p, CH5, CH6, CH7);
        const skySpan = CH6 - CH5;
        const spaceSpan = CH7 - CH6;
        // Named points in the summit window, so a re-layout moves them together.
        const summitStart = CH6 - skySpan * SUMMIT_EARTH_REVEAL.startBeforeBoundary;
        const summitEnd = CH6 - skySpan * SUMMIT_EARTH_REVEAL.endBeforeBoundary;
        const gateEnd = CH6 + spaceSpan * SUMMIT_EARTH_REVEAL.spaceGateBand;
        const mid = (a, b) => a + (b - a) * 0.5;

        it('reveals the earth while the Ch5 sky is still bright', () => {
            // Nothing at the start of Ch5...
            expect(stage(summitStart - 0.001).earthReveal).toBe(0);
            // ...rising as the camera crests the summit...
            expect(stage(mid(summitStart, summitEnd)).earthReveal).toBeGreaterThan(0.15);
            // ...and FULLY present before the boundary, i.e. before the dome fade even
            // begins. This is the whole point: the windows used to be disjoint.
            expect(stage(summitEnd).earthReveal).toBeGreaterThan(0.99);
            expect(summitEnd).toBeLessThan(CH6);
        });

        it('never lets the earth drop back out once space darkens', () => {
            const samples = [summitEnd, CH6, gateEnd, mid(gateEnd, CH7), CH7 - 0.01, CH7];
            samples.forEach((p) => expect(stage(p).earthReveal).toBeGreaterThan(0.99));
        });

        it('holds the rest of Space out of the daylight frame', () => {
            // Through the whole summit reveal window the space gate is shut, so stars,
            // the black hole, the nebula and the void dome cannot leak into the bright
            // sky (the "do not re-wash space" constraint runs the other way too).
            [summitStart, mid(summitStart, summitEnd), summitEnd, CH6 - 0.0001].forEach((p) => {
                expect(stage(p).spaceReveal).toBe(0);
            });
            // It opens only once the camera is actually past the boundary, and — since the
            // gate widened 0.06 -> 0.16 — it now RAMPS across a real window rather than
            // flipping. Probe inside the window, not at a pre-ascent literal.
            const insideGate = mid(CH6, gateEnd);
            expect(stage(insideGate).spaceReveal).toBeGreaterThan(0);
            expect(stage(insideGate).spaceReveal).toBeLessThan(1);
            expect(stage(gateEnd).spaceReveal).toBe(1);
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
            // Wave 3: the sculpted field stages via its own uniform (setOpacityScale
            // must never touch its opaque material) — held shut in the summit window.
            expect(group.userData.nebulaField.userData.uReveal.value).toBeLessThan(0.01);
            expect(group.userData.nebulaField.visible).toBe(false);
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

// ── THE setOpacityScale RE-ARM ───────────────────────────────────────────────────
// In r181 NodeMaterial resolves alpha as `this.opacityNode ? float(this.opacityNode)
// : materialOpacity` (NodeMaterial.js:872). Assigning an opacityNode therefore REPLACES
// the `material.opacity` uniform that setOpacityScale drives, silently reducing the whole
// staging system to the `root.visible` boolean on its next line.
//
// That is not hypothetical: it shipped. The 5->6 seam metric measured mean frame luma at
// 41.5 / 45.3 / 43.2 / 43.9 across p=0.7441..0.7621 while `spaceReveal` went 0.107 -> 1.0.
// Flat, across a 10x change in the value that was supposed to be fading it up.
//
// This suite exists so a NEW material with an opacityNode cannot rejoin that failure
// silently. It reads the module source rather than instantiating every material, because
// several of them are only reachable through a full createCosmicExpanseEnvironment build.
describe('setOpacityScale re-arm (Act II->Space §8.4)', () => {
    const source = readFileSync(
        fileURLToPath(new URL('./cosmic-expanse.js', import.meta.url)),
        'utf8',
    );

    it('ends every opacityNode assignment with .mul(materialOpacity)', () => {
        // Assignments may span lines, so match up to the terminating semicolon.
        const assignments = source.match(/^\s*\w+\.opacityNode = [\s\S]*?;$/gm) || [];
        expect(assignments.length).toBeGreaterThanOrEqual(8);

        const unarmed = assignments.filter((a) => !a.includes('materialOpacity'));
        expect(unarmed).toEqual([]);
    });

    it('imports the materialOpacity node it depends on', () => {
        expect(source).toMatch(/^\s*materialOpacity,$/m);
    });

    it('keeps the dead-write warning attached to setOpacityScale', () => {
        // The comment IS the fix's documentation; losing it is how this regresses.
        const fn = source.slice(source.indexOf('function setOpacityScale'));
        expect(fn.slice(0, 2000)).toContain('DEAD WRITE');
        expect(fn.slice(0, 2000)).toContain('NodeMaterial.js:872');
    });
});

// ── THE transparent + DoubleSide DOUBLE-BILL ─────────────────────────────────────
// r181 splits a transparent DoubleSide material into a back-face pass and a front-face pass
// (Renderer.js:3131). Where blending is Additive with depthWrite off the two passes are
// order-independent, so the split is pure waste and `forceSinglePass = true` reclaims it.
// This repo has repeatedly rediscovered that cost; the guard is here so ch6 cannot re-buy it.
describe('additive DoubleSide materials do not double-bill (Act II->Space §8.6)', () => {
    const source = readFileSync(
        fileURLToPath(new URL('./cosmic-expanse.js', import.meta.url)),
        'utf8',
    );

    it('pairs every transparent DoubleSide + Additive material with forceSinglePass', () => {
        // Walk each material block and check the combination, rather than counting globally —
        // a global count passes while the WRONG material carries the flag.
        const blocks = source.split(/const \w*[Mm]at(?:erial)? = new THREE\./).slice(1);
        const offenders = blocks
            .map((b) => b.slice(0, b.indexOf('const mesh') + 1 || 3000))
            .filter((b) => b.includes('THREE.DoubleSide')
                && b.includes('AdditiveBlending')
                && !b.includes('transparent = false'))
            .filter((b) => !b.includes('forceSinglePass'));
        expect(offenders).toEqual([]);
    });

    it('leaves the OPAQUE DoubleSide comet tail alone', () => {
        // It is alphaTest + depthWrite, never entering the blend queue, so r181 does not
        // split it and forceSinglePass would be cargo cult. Pinned so a future sweep that
        // "fixes" every DoubleSide material has to justify touching this one.
        const tail = source.slice(source.indexOf('const tailMat = new THREE.'));
        expect(tail.slice(0, 400)).toContain('THREE.DoubleSide');
        expect(tail.slice(0, 400)).toContain('transparent = false');
        expect(tail.slice(0, 400)).not.toContain('forceSinglePass');
    });
});

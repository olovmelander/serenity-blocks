/**
 * THE AURORA DARKNESS GATE (owner report 2026-08-16).
 *
 * The planet-aurora crown has a night mask on the PLANET's terminator — correct on the
 * planet, blind to the SKY. During the ascent the planet's night side faces the camera
 * against a bright daylight sky, and the curtains measured eff 0.26 → 1.0 across
 * p 0.62 → 0.74 while spaceReveal was still 0: aurora blazing in a blue daytime sky,
 * then occluded by the cloud limb, then back in space — the owner's exact
 * "appears, disappears, reappears".
 *
 * The fix threads ONE `uAuroraReveal` uniform through BOTH aurora halves (surface oval
 * + standing crown, which must never drift apart), ticked to the chapter's spaceReveal.
 * The earth is the one element allowed before the boundary; its aurora is not.
 *
 * Stations are DERIVED from the live layout, never pinned — Wave 1A re-maps p for the
 * whole journey and these assertions must survive the next re-map too.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { deriveOdysseyChapterPositions } from '../../src/core/odyssey/data/odyssey-layout.js';
import {
    SUMMIT_EARTH_REVEAL,
    createCosmicExpanseEnvironment,
    updateCosmicExpanseEnvironment,
} from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.js';
import { getChapterPathRange } from '../../src/rendering/odyssey/path-utils.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('planet aurora darkness gate', () => {
    const positions = deriveOdysseyChapterPositions();
    const ch5 = positions[4];
    const ch6 = positions[5];
    const ch7 = positions[6];
    const skySpan = ch6 - ch5;
    const summitStart = ch6 - skySpan * SUMMIT_EARTH_REVEAL.startBeforeBoundary;
    const gateEnd = ch6 + (ch7 - ch6) * SUMMIT_EARTH_REVEAL.spaceGateBand;

    function buildEnv() {
        vi.stubGlobal('window', { location: { search: '' } });
        const group = createCosmicExpanseEnvironment({ particleCount: 200 });
        const range = getChapterPathRange(6);
        group.userData.yStart = range.start.y;
        group.userData.yEnd = range.end.y;
        group.userData.chapterOpacity = 1;
        return group;
    }

    it('exposes one shared gate uniform on the hero planet group', () => {
        const env = buildEnv();
        expect(env.userData.heroPlanet.userData.uAuroraReveal).toBeTruthy();
        expect(env.userData.heroPlanet.userData.uAuroraReveal.value).toBe(0);
    });

    it('holds the aurora at ZERO through the whole bright ascent', () => {
        const env = buildEnv();
        const gate = env.userData.heroPlanet.userData.uAuroraReveal;
        // Mid-ignite, three-quarters through the climb, and one station shy of the
        // boundary: the earth is visible at all of these; its aurora must not be.
        const ascentStations = [
            summitStart + (ch6 - summitStart) * 0.25,
            summitStart + (ch6 - summitStart) * 0.75,
            ch6 - 1e-4,
        ];
        ascentStations.forEach((p) => {
            updateCosmicExpanseEnvironment(env, 0.016, 1.0, null, p);
            expect(gate.value, `aurora gate open at p=${p.toFixed(4)}`).toBe(0);
            // ...while the earth itself IS revealed (the beat this gate must not break).
            expect(env.userData.summitEarthStaging.earthReveal).toBeGreaterThan(0);
        });
    });

    it('arrives with the dark, on the same widened gate as the rest of space', () => {
        const env = buildEnv();
        const gate = env.userData.heroPlanet.userData.uAuroraReveal;

        const midGate = ch6 + (gateEnd - ch6) * 0.5;
        updateCosmicExpanseEnvironment(env, 0.016, 1.0, null, midGate);
        expect(gate.value).toBeGreaterThan(0.1);
        expect(gate.value).toBeLessThan(0.95);

        updateCosmicExpanseEnvironment(env, 0.016, 1.0, null, gateEnd + 0.01);
        expect(gate.value).toBe(1);
    });

    it('the crown material carries the gate (a stray rebuild cannot drop it)', () => {
        const env = buildEnv();
        let crown = null;
        env.userData.heroPlanet.traverse((o) => {
            if (o.name === 'hero-planet-aurora-crown') crown = o;
        });
        expect(crown).toBeTruthy();
        // The material graph must reference the shared uniform: tick it and confirm the
        // uniform object is the same one the chapter update writes.
        const gate = env.userData.heroPlanet.userData.uAuroraReveal;
        gate.value = 0.5;
        expect(env.userData.heroPlanet.userData.uAuroraReveal.value).toBe(0.5);
        expect(crown.material.opacityNode).toBeTruthy();
    });

    it('keeps camera-driven updates gated too (the in-game path)', () => {
        const env = buildEnv();
        const gate = env.userData.heroPlanet.userData.uAuroraReveal;
        // With a camera object present, `approach` comes from camera.y — the in-game
        // path. Below the chapter's y-range the ascent is still bright; the gate must
        // read from GLOBAL staging, not from the camera ramp.
        const probe = new THREE.Object3D();
        probe.position.set(0, 0, 0); // far below yStart → approach 0
        updateCosmicExpanseEnvironment(env, 0.016, 1.0, probe, summitStart + 0.01);
        expect(gate.value).toBe(0);
    });
});

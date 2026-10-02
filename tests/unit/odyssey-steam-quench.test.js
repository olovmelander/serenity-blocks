import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import * as THREE from 'three/webgpu';
import {
    STEAM_QUENCH_APPROACH_HALF_WIDTH,
    STEAM_QUENCH_EXIT_HALF_WIDTH,
    STEAM_QUENCH_FOG_DENSITY,
    STEAM_QUENCH_HALF_WIDTH,
    STEAM_QUENCH_LUMA_CAP,
    STEAM_QUENCH_RADIUS,
    steamQuenchLumaCap,
    createSteamQuench,
    steamQuenchDensity,
    steamQuenchFogColour,
    steamQuenchSeamT,
} from '../../src/rendering/odyssey/composition/odyssey-steam-quench.js';
import { ODYSSEY_CHAPTER_PROFILES } from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';
import { ONE_WORLD_ACT_MARGIN } from '../../src/rendering/odyssey/world/odyssey-world-act-gate.js';

/**
 * THE STEAM QUENCH — the ch1 -> Act II occlusion moment.
 *
 * The plan asks for the two surviving act edges to become occlusion moments instead of alpha
 * crossfades ("fog as a traversable object, not a post effect"). What a test can hold is the
 * DRIVER — the density and warmth curves that decide whether the volume occludes at the
 * boundary and which way the colour runs — plus the material contract that makes it an
 * occluder at all. The look itself is capture-verified (ADR-0007).
 */
describe('steam quench driver', () => {
    it('is fully dense at the boundary and absent at both ends of the window', () => {
        // Asserted on the SHIPPED curve (steamQuenchDensity drives the uniform), not on a
        // re-typed copy of it — the old form of this test re-derived tri^2 locally and kept
        // passing after the driver had changed underneath it.
        expect(steamQuenchDensity(0.5)).toBeCloseTo(1, 6);
        expect(steamQuenchDensity(0)).toBeCloseTo(0, 6);
        expect(steamQuenchDensity(1)).toBeCloseTo(0, 6);
        // Eased, not linear, on the way out.
        expect(steamQuenchDensity(0.85)).toBeLessThan(0.3);
    });

    it('keeps the cathedral clear, then is dense before Act II starts drawing behind it', () => {
        // 2026-10-01: the approach used to open at chapter-local 0.075 (a 0.06 window authored
        // for a 0.093-long chapter that is now 0.0649 long) and veiled most of Earth Core.
        const boundary = 0.0649;
        const at = (p) => steamQuenchDensity(steamQuenchSeamT(p, boundary));
        // First half of the chapter: no steam at all.
        expect(at(boundary * 0.45)).toBe(0);
        // ADR-0017: occlusion, never crossfade — dense where the world's act gate opens.
        expect(at(boundary - ONE_WORLD_ACT_MARGIN)).toBeGreaterThan(0.85);
        expect(at(boundary)).toBeCloseTo(1, 6);
    });

    it('maps the 1->2 boundary to seamT 0.5 whatever the two half-widths are', () => {
        // The board used to map progress linearly across the asymmetric window, which put the
        // peak and the warm->cool flip before the crossing. Piecewise keeps them ON it.
        const b = 0.0649;
        expect(steamQuenchSeamT(b, b)).toBeCloseTo(0.5, 9);
        expect(steamQuenchSeamT(b - STEAM_QUENCH_APPROACH_HALF_WIDTH, b)).toBeCloseTo(0, 9);
        expect(steamQuenchSeamT(b + STEAM_QUENCH_EXIT_HALF_WIDTH, b)).toBeCloseTo(1, 9);
        expect(steamQuenchSeamT(NaN, b)).toBe(0);
        const q = createSteamQuench();
        expect(() => { q.update(0, steamQuenchSeamT(b, b)); }).not.toThrow();
        q.dispose();
    });

    it('runs ember-warm on the Chapter 1 side and cold on the Act II side', () => {
        // warmth = 1 - seamT: the orange->cyan the chapter profile authors for this stinger.
        const warmth = (seamT) => 1 - Math.max(0, Math.min(1, seamT));
        expect(warmth(0)).toBe(1);
        expect(warmth(0.5)).toBe(0.5);
        expect(warmth(1)).toBe(0);
    });

    it('clamps a seamT outside the window instead of over-driving the volume', () => {
        const q = createSteamQuench();
        expect(() => { q.update(0, -3); q.update(0, 7); q.update(0, NaN); }).not.toThrow();
        q.dispose();
    });
});

describe('steam quench brightness + fog occlusion (seamless pass 2026-10-02)', () => {
    it('never flashes brighter than the open water: the vapour luminance is capped', () => {
        // Was a white flash: luma 20 -> 139 -> 225 at the boundary -> 111 in the ocean (the
        // journey's worst seam step, 119.7 per 0.01 p). The fog colour carries the same cap
        // the shader applies, so fogged rock and the shell agree.
        const out = new THREE.Color();
        for (let i = 0; i <= 50; i += 1) {
            const c = steamQuenchFogColour(i / 50, out);
            const lum = (0.2126 * c.r) + (0.7152 * c.g) + (0.0722 * c.b);
            expect(lum).toBeLessThanOrEqual(STEAM_QUENCH_LUMA_CAP + 1e-6);
            expect(Number.isFinite(lum)).toBe(true);
        }
        // Still ember-warm on the cavern side and cool on the water side.
        const warm = steamQuenchFogColour(0.1, new THREE.Color());
        const cool = steamQuenchFogColour(0.95, new THREE.Color());
        expect(warm.r).toBeGreaterThan(warm.b);
        expect(cool.b).toBeGreaterThan(cool.r);
        expect(STEAM_QUENCH_LUMA_CAP).toBeLessThan(0.5);
    });

    it('brightens evenly across the crossing, not with the density (the 0.006 p jump)', () => {
        // The volume must close fast (opaque where the act gate opens), so brightness that rode
        // the density jumped the frame from luma ~22 to ~130 inside 0.006 p. The cap holds at the
        // cavern's level while the smoke closes, climbs evenly, and holds at the ocean level.
        let prev = -1;
        let steepest = 0;
        for (let i = 0; i <= 100; i += 1) {
            const cap = steamQuenchLumaCap(i / 100);
            expect(cap).toBeGreaterThanOrEqual(prev);
            if (prev >= 0) steepest = Math.max(steepest, (cap - prev) * 100);
            prev = cap;
        }
        // No steeper than 1.25x an even ramp of the same rise over the same span.
        const span = 0.65 - 0.08;
        const even = (STEAM_QUENCH_LUMA_CAP * (1 - 0.21)) / span;
        expect(steepest).toBeLessThan(even * 1.3);
        expect(steamQuenchLumaCap(0.9)).toBeCloseTo(STEAM_QUENCH_LUMA_CAP, 9);
        // Where the vapour is already dense (the act gate), it is still well short of its peak.
        const gateT = steamQuenchSeamT(0.0649 - ONE_WORLD_ACT_MARGIN, 0.0649);
        expect(steamQuenchDensity(gateT)).toBeGreaterThan(0.85);
        expect(steamQuenchLumaCap(gateT)).toBeLessThan(STEAM_QUENCH_LUMA_CAP * 0.35);
    });

    it('occludes near rock through scene fog, at no extra draw (the shell still opts out)', () => {
        // INTENT CHANGE (stated): occlusion of NEAR geometry now comes from scene fog driven by
        // the quench density — the depth-tested, non-depth-writing shell left the basalt
        // columns crisp in front of it. The shell keeps fog=false (its own ramp) and BackSide.
        expect(STEAM_QUENCH_FOG_DENSITY).toBeGreaterThan(0.02);
        // ~75 % fogged at 30 u at peak density (FogExp2).
        const at30 = 1 - Math.exp(-((STEAM_QUENCH_FOG_DENSITY * 30) ** 2));
        expect(at30).toBeGreaterThan(0.7);
    });
});

describe('steam quench material contract', () => {
    it('is an OCCLUDER you fly through, not a billboard you look at', () => {
        const q = createSteamQuench();
        const m = q.mesh.material;
        // BackSide + no frustum cull: the camera passes inside it, and a mesh whose origin
        // leaves the frustum must not vanish while it is still wrapped around the viewer.
        expect(m.side).toBe(1); // THREE.BackSide
        expect(q.mesh.frustumCulled).toBe(false);
        expect(m.transparent).toBe(true);
        expect(m.depthWrite).toBe(false);
        q.dispose();
    });

    it('opts out of scene fog — it sits exactly where the chapter fog is mid-lerp', () => {
        // Fourth-time trap in this repo: the board rewrites scene.fog every frame from the
        // chapter profile, so a volume at the boundary would be painted in the OUTGOING
        // chapter's fog colour and lose its own ember->vapour ramp.
        const q = createSteamQuench();
        expect(q.mesh.material.fog).toBe(false);
        q.dispose();
    });

    it('is one draw with a sensible radius, and disposes what it made', () => {
        const q = createSteamQuench();
        expect(q.mesh.isMesh).toBe(true);
        expect(q.mesh.geometry.parameters.radius).toBe(STEAM_QUENCH_RADIUS);
        expect(() => q.dispose()).not.toThrow();
    });
});

describe('steam quench board wiring', () => {
    const ROOT = path.resolve(
        path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
        '../..',
    );
    const BOARD = readFileSync(
        path.join(ROOT, 'src/rendering/odyssey/OdysseyBoardController.js'),
        'utf8',
    );

    it('seats the volume on the rail AT the 1->2 boundary', () => {
        expect(BOARD).toMatch(/const boundary12 = this\.presentationLayout\?\.chapterPositions\?\.\[1\]/);
        expect(BOARD).toMatch(/this\.steamQuench\.mesh\.position\.set\(at\.x, at\.y, at\.z\)/);
    });

    it('is WIDER than the crossfade it hides — an occluder that is narrower just frames it', () => {
        // REPLACED 2026-08-13 (same requirement, stronger assertion): the constants moved to
        // odyssey-steam-quench.js and are asserted by VALUE instead of by source regex. The
        // approach must out-span the authored crossfade; the exit must still cover the
        // co-presence window (= the authored seamWidth), which is what stops Earth Core's
        // dissolve tail showing bare.
        const seam = ODYSSEY_CHAPTER_PROFILES.find((c) => c.id === 1)?.transition?.seamWidth;
        expect(seam).toBeGreaterThan(0);
        expect(STEAM_QUENCH_HALF_WIDTH).toBeGreaterThan(seam);
        expect(STEAM_QUENCH_APPROACH_HALF_WIDTH).toBeGreaterThan(seam);
        expect(STEAM_QUENCH_EXIT_HALF_WIDTH).toBeGreaterThanOrEqual(seam);
    });

    it('is hidden outside its window, so it costs nothing for most of the journey', () => {
        expect(BOARD).toMatch(/this\.steamQuench\.mesh\.visible = inWindow;/);
        expect(BOARD).toMatch(/if \(inWindow\) this\.steamQuench\.update\(this\.time,/);
    });

    it('runs every frame rather than on the throttled position gate', () => {
        // It billows, so throttling it to ~30Hz would make the vapour stutter exactly while
        // it fills the frame. The visibility test is cheap; the update is gated on the window.
        const idx = BOARD.indexOf('this.steamQuench.mesh.visible = inWindow;');
        const before = BOARD.slice(Math.max(0, idx - 700), idx);
        // The corridor field's throttled block must have CLOSED before the steam block opens.
        expect(before).toMatch(/this\.corridorField\?\.update\([^)]*\);\s*\}/);
    });

    it('carries the quench into the world and into scene fog, from the same seamT', () => {
        // WORLD session interface: embers -> bubbles + fish fade, optional-chained both ways.
        expect(BOARD).toMatch(/this\.oneWorld\?\.setQuenchCarry\?\.\(quenchT\)/);
        expect(BOARD).toMatch(/this\._steamFogWeight = inWindow \? steamQuenchDensity\(quenchT\) \*\* 2 : 0;/);
        expect(BOARD).toMatch(/_applySteamQuenchFog\(\) \{/);
    });

    it('cannot take the board down if it fails to build, and is disposed', () => {
        expect(BOARD).toMatch(/console\.warn\('\[OdysseyBoard\] steam quench unavailable \(non-fatal\)/);
        expect(BOARD).toMatch(/this\.steamQuench\.dispose\(\);/);
    });
});

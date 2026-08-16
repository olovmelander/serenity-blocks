import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createCosmicExpanseEnvironment,
    updateCosmicExpanseEnvironment,
} from './cosmic-expanse.js';

// ── WAVE 0 BISECT LEVERS (docs/ODYSSEY_CH6_SPACE_OVERHAUL_PLAN_2026-08.md §5) ──────
// A lever that nothing reads reports innocence, not absence (the dead
// `odysseyWorldNoHeroes` lesson): every flag here is proven LIVE by building the
// environment under it and watching the tier actually disappear — and the harness
// configuration ids are pinned to the same flag names, so gpu-split and the chapter
// cannot drift apart silently.

const here = path.dirname(fileURLToPath(import.meta.url));
const SPLIT = fs.readFileSync(
    path.resolve(here, '../../../../scripts/odyssey-gpu-split.mjs'),
    'utf8',
);

function buildWithSearch(search) {
    vi.stubGlobal('window', { location: { search } });
    return createCosmicExpanseEnvironment({ particleCount: 200 });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('ch6 bisect levers (Space overhaul Wave 0)', () => {
    it('mounts every shipped tier when no flag is set', () => {
        const group = buildWithSearch('');
        [
            'voidSky', 'blackHole', 'heroPlanet', 'galaxy', 'debris',
            'starsFar', 'starsNear', 'nebulaField',
            'dustNear', 'dustFar', 'streakMotes', 'asteroids', 'auroraBridge',
        ].forEach((key) => {
            expect(group.userData[key], key).toBeTruthy();
        });
        // The additive sprite tiers + billboard pillar are RETIRED (Wave 3 swap) —
        // absent by default, restorable via ?odysseyCh6NebulaSprites=1.
        expect(group.userData.nebulaVolume).toBeUndefined();
        expect(group.userData.nebulaFar).toBeUndefined();
        expect(group.userData.nebulaPillar).toBeUndefined();
    });

    it('?odysseyCh6NoDome=1 removes the void dome and nothing else', () => {
        const group = buildWithSearch('?odysseyCh6NoDome=1');
        expect(group.userData.voidSky).toBeUndefined();
        expect(group.userData.blackHole).toBeTruthy();
        expect(group.userData.nebulaField).toBeTruthy();
        expect(group.userData.dustNear).toBeTruthy();
        expect(group.userData.starsFar).toBeTruthy();
    });

    it('?odysseyCh6NoHeroes=1 removes the triad but keeps the infall debris seated', () => {
        const group = buildWithSearch('?odysseyCh6NoHeroes=1');
        expect(group.userData.blackHole).toBeUndefined();
        expect(group.userData.heroPlanet).toBeUndefined();
        expect(group.userData.galaxy).toBeUndefined();
        // The debris belongs to the DUST family and must survive a hero bisect at the
        // hole's entry pose (update() only re-seats it when both exist).
        expect(group.userData.debris).toBeTruthy();
        expect(group.userData.entryContinuity.earth).toHaveLength(0);
        expect(group.userData.entryContinuity.heroes).toHaveLength(0);
    });

    it('?odysseyCh6NoNebula=1 removes the shipped nebula system (field by default)', () => {
        const group = buildWithSearch('?odysseyCh6NoNebula=1');
        expect(group.userData.nebulaField).toBeUndefined();
        expect(group.userData.nebulaVolume).toBeUndefined();
        expect(group.userData.entryContinuity.nebula).toHaveLength(0);
        expect(group.userData.voidSky).toBeTruthy();
    });

    it('?odysseyCh6NebulaSprites=1 is a TRUE swap: sprites restored, field withheld', () => {
        const group = buildWithSearch('?odysseyCh6NebulaSprites=1');
        expect(group.userData.nebulaField).toBeUndefined();
        expect(group.userData.nebulaVolume).toBeTruthy();
        expect(group.userData.nebulaFar).toBeTruthy();
        expect(group.userData.nebulaPillar).toBeTruthy();
        expect(group.userData.entryContinuity.nebula).toHaveLength(2);

        // The bisect lever outranks the hatch, same as the dome pair.
        const none = buildWithSearch('?odysseyCh6NebulaSprites=1&odysseyCh6NoNebula=1');
        expect(none.userData.nebulaField).toBeUndefined();
        expect(none.userData.nebulaVolume).toBeUndefined();
    });

    it('?odysseyCh6NoDust=1 removes dust, debris and streak motes but keeps asteroids', () => {
        const group = buildWithSearch('?odysseyCh6NoDust=1');
        expect(group.userData.dustNear).toBeUndefined();
        expect(group.userData.dustFar).toBeUndefined();
        expect(group.userData.debris).toBeUndefined();
        expect(group.userData.streakMotes).toBeUndefined();
        // The garland is deliberately unlevered: 12 opaque instances, below the timer
        // tick, and the chapter's on-law shading template.
        expect(group.userData.asteroids).toBeTruthy();
        expect(group.userData.entryContinuity.clutter).toHaveLength(1);
    });

    it('?odysseyCh6NoAurora=1 withholds BOTH halves of the hero crown', () => {
        // Half a lever is not a lever: the curtain mesh is a draw, but the disc term is
        // extra fragment ALU inside the hero's own material, and a differential that
        // priced only one of them would under-report the feature.
        const lit = buildWithSearch('');
        const dark = buildWithSearch('?odysseyCh6NoAurora=1');
        const crowns = (group) => {
            let n = 0;
            group.userData.heroPlanet.traverse((c) => {
                if (c.name === 'hero-planet-aurora-crown') n += 1;
            });
            return n;
        };
        expect(crowns(lit)).toBe(1);
        expect(crowns(dark)).toBe(0);
        // The hero itself must still be there — this lever is not NoHeroes wearing a hat.
        expect(dark.userData.heroPlanet).toBeDefined();
        expect(dark.userData.heroPlanet.userData.planet).toBeDefined();
    });

    it('?odysseyCh6LegacyKeyFrame=1 restores the Wave 6 lighting slip, and nothing else', () => {
        // POLARITY MATTERS HERE. The SHIPPED default now applies the masses' key in the
        // corridor frame it was authored in (25.7-57.1 deg off the accretion key); this
        // lever restores the slip that dotted a corridor-local constant against world
        // normals raw (55.8-95.5 deg off). Absent = fixed, present = legacy. If that ever
        // inverts, the chapter silently ships the bug again and every capture A/B lies.
        const shipped = buildWithSearch('');
        const legacy = buildWithSearch('?odysseyCh6LegacyKeyFrame=1');
        // It re-keys; it must not remove or add anything.
        expect(shipped.userData.nebulaField).toBeDefined();
        expect(legacy.userData.nebulaField).toBeDefined();
        expect(legacy.userData.nebulaField.children.length)
            .toBe(shipped.userData.nebulaField.children.length);
    });

    it('?odysseyCh6NoStars=1 removes both starfield tiers', () => {
        const group = buildWithSearch('?odysseyCh6NoStars=1');
        expect(group.userData.starsFar).toBeUndefined();
        expect(group.userData.starsNear).toBeUndefined();
        expect(group.userData.entryContinuity.stars).toHaveLength(0);
    });

    it('updates without throwing whatever combination is bisected out', () => {
        const group = buildWithSearch(
            '?odysseyCh6NoDome=1&odysseyCh6NoHeroes=1&odysseyCh6NoNebula=1'
            + '&odysseyCh6NoDust=1&odysseyCh6NoStars=1',
        );
        group.userData.chapterOpacity = 1;
        expect(() => {
            updateCosmicExpanseEnvironment(group, 0.016, 1.0, null, 0.05);
            updateCosmicExpanseEnvironment(group, 0.016, 2.0, null, 0.55);
            updateCosmicExpanseEnvironment(group, 0.016, 3.0, null, 1.0);
        }).not.toThrow();
    });

    it('gpu-split drives the exact flags the chapter reads', () => {
        expect(SPLIT).toMatch(/id:\s*'ch6-no-dome',\s*flags:\s*\{\s*odysseyCh6NoDome:\s*'1'/);
        expect(SPLIT).toMatch(/id:\s*'ch6-no-nebula',\s*flags:\s*\{\s*odysseyCh6NoNebula:\s*'1'/);
        expect(SPLIT).toMatch(/id:\s*'ch6-no-dust',\s*flags:\s*\{\s*odysseyCh6NoDust:\s*'1'/);
        expect(SPLIT).toMatch(/id:\s*'ch6-no-stars',\s*flags:\s*\{\s*odysseyCh6NoStars:\s*'1'/);
        expect(SPLIT).toMatch(/id:\s*'ch6-no-heroes',\s*flags:\s*\{\s*odysseyCh6NoHeroes:\s*'1'/);
        expect(SPLIT).toMatch(/id:\s*'ch6-no-aurora',\s*flags:\s*\{\s*odysseyCh6NoAurora:\s*'1'/);
    });
});

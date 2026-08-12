import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { createCosmicExpanseEnvironment } from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.js';
import {
    createBlackHoleTranscendenceEnvironment,
} from '../../src/rendering/odyssey/chapter-environments/black-hole-transcendence.js';
import { createUrbanDreamsEnvironment } from '../../src/rendering/odyssey/chapter-environments/urban-dreams.js';

/**
 * WAVE 5 — the fog lint, extended from the world to the chapters that still draw.
 *
 * The trap, which has now cost three separate sessions (the painterly-ascent sky dome, the
 * Ch6 summit earth, and the One World ground): the board rewrites `scene.fog` EVERY FRAME
 * from the chapter profile, and FogExp2 is `1 - exp(-(d*z)^2)`. At the densities these
 * chapters use, anything a kilometre out is ~100% saturated to the fog colour. There is no
 * error, no warning, and the material's own authored colour is simply never visible. It reads
 * as "right in the playground, washed in-game", which is a palette bug until you know better.
 *
 * `odyssey-world-lints.test.js` already pins this for the WORLD's five materials by matching
 * the opt-out list against the constructor list. That protects Act II and nothing else. The
 * chapters that still draw their own environments — 6, 7 and 8 — opt out by bulk
 * `group.traverse`, which is a different shape and needs a different guard: a traverse only
 * covers what is already parented when it runs, so a mesh added afterwards, or attached to a
 * sibling group, silently ships fogged.
 *
 * So this checks BEHAVIOUR rather than source. It builds each environment for real and walks
 * it, which is the only form that catches the failure the traverse pattern actually has.
 *
 * Chapter 1 (Earth Core) is deliberately absent: it is an enclosed magma cavern whose profile
 * runs fogDensity 0.014, and there the fog IS the look rather than an accident. This test is
 * about surfaces at celestial range, not about every material in the game.
 */

/** How far out a mesh has to sit before scene fog is certain to eat it. */
const FAR_RANGE = 400;

const CHAPTERS = [
    {
        id: 6,
        name: 'Cosmic Expanse',
        build: () => createCosmicExpanseEnvironment({ particleCount: 64 }),
    },
    {
        id: 7,
        name: 'Black Hole Transcendence',
        build: () => createBlackHoleTranscendenceEnvironment({ particleCount: 64 }),
    },
    {
        id: 8,
        name: 'Urban Dreams',
        build: () => createUrbanDreamsEnvironment(),
    },
];

/**
 * Every mesh in `root` sitting further than FAR_RANGE from the chapter origin, with the
 * materials that would be fogged. Distance is measured to the mesh's world position, which is
 * what the fog term uses.
 */
function farRangeOffenders(root) {
    root.updateMatrixWorld(true);
    const offenders = [];
    const pos = new THREE.Vector3();
    root.traverse((child) => {
        if (!child.isMesh && !child.isPoints && !child.isSprite) return;
        child.getWorldPosition(pos);
        const dist = pos.length();
        if (dist <= FAR_RANGE) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
            // `fog` is undefined on materials that do not support it at all; only a material
            // that supports fog and has it left ON is a problem.
            if (material && material.fog === true) {
                offenders.push(`${child.name || child.type} @ ${Math.round(dist)}u`);
            }
        });
    });
    return offenders;
}

describe('chapters that still draw opt their far-range surfaces out of scene fog', () => {
    CHAPTERS.forEach(({ id, name, build }) => {
        it(`ch${id} ${name}: nothing beyond ${FAR_RANGE}u is left fogged`, () => {
            const env = build();
            try {
                const offenders = farRangeOffenders(env);
                expect(
                    offenders,
                    `these surfaces would be painted in fog colour instead of their own:\n  ${offenders.join('\n  ')}`,
                ).toEqual([]);
            } finally {
                env.traverse?.((c) => {
                    if (c.geometry?.dispose) c.geometry.dispose();
                    const mats = Array.isArray(c.material) ? c.material : [c.material];
                    mats.forEach((m) => m?.dispose?.());
                });
            }
        });
    });

    it('actually finds far-range meshes, so a passing run is not a vacuous one', () => {
        // A guard that silently stops traversing anything would pass every assertion above
        // while checking nothing. Pin that at least one chapter really does put geometry out
        // at celestial range.
        const env = createCosmicExpanseEnvironment({ particleCount: 64 });
        env.updateMatrixWorld(true);
        let far = 0;
        const pos = new THREE.Vector3();
        env.traverse((c) => {
            if (!c.isMesh && !c.isPoints) return;
            c.getWorldPosition(pos);
            if (pos.length() > FAR_RANGE) far += 1;
        });
        expect(far).toBeGreaterThan(0);
    });
});

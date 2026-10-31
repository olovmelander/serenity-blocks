import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATIC_SHADOW_FIRST_DRAWS, redrawStaticShadow } from '../../src/themes/shared/static-shadow-draws.js';

/**
 * A light's update then three's render, frame after frame. `draws(frame)` says whether that frame drew
 * something receiving the map (three draws a shadow map only then, and clears needsUpdate when it has).
 * Returns the frames whose render drew the map.
 */
function run({ frames, draws = () => true, marks = () => false, owner = { shadowDraws: 0 } }) {
    const shadow = { needsUpdate: true }; // as the lights' constructors leave it
    const drawn = [];
    for (let frame = 1; frame <= frames; frame++) {
        redrawStaticShadow(owner, shadow, marks(frame));
        if (shadow.needsUpdate && draws(frame)) {
            drawn.push(frame);
            shadow.needsUpdate = false;
        }
    }
    return { drawn, owner, shadow };
}

/** What `shadowFrames < 10 || marks` asked for: the rule before 2026-10-31. */
function frameRule({ frames, marks = () => false }) {
    const shadow = { needsUpdate: true };
    const drawn = [];
    for (let frame = 1; frame <= frames; frame++) {
        if (frame < 10 || marks(frame)) shadow.needsUpdate = true;
        if (shadow.needsUpdate) {
            drawn.push(frame);
            shadow.needsUpdate = false;
        }
    }
    return drawn;
}

describe('redrawStaticShadow', () => {
    const marks = (frame) => frame === 45 || frame === 150;

    it('redraws on the same frames as the old frame count when every frame draws', () => {
        expect(run({ frames: 200, marks }).drawn).toEqual(frameRule({ frames: 200, marks }));
        expect(run({ frames: 200, marks }).drawn).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 45, 150]);
        expect(STATIC_SHADOW_FIRST_DRAWS).toBe(9);
    });

    it('keeps asking until the map has had its first draws when the first frames draw nothing', () => {
        // A sliced hidden build: no receiver is drawn for the first 30 frames.
        const { drawn } = run({ frames: 200, marks, draws: (frame) => frame > 30 });
        expect(drawn).toEqual([31, 32, 33, 34, 35, 36, 37, 38, 39, 45, 150]);
        // Frames that draw only now and then: still nine early draws.
        const sparse = run({ frames: 200, draws: (frame) => frame % 4 === 0 }).drawn;
        expect(sparse.slice(0, 9)).toEqual([4, 8, 12, 16, 20, 24, 28, 32, 36]);
        expect(sparse).toHaveLength(9);
    });

    it('starts over when the caller resets the count, and counts only draws three made', () => {
        const owner = { shadowDraws: 0 };
        run({ frames: 20, owner });
        expect(owner.shadowDraws).toBe(9);
        owner.shadowDraws = 0; // frameShadows()
        expect(run({ frames: 20, owner }).drawn).toHaveLength(9);
        // A map asked for but never drawn (no receiver, or a precompile frame) is not counted.
        const idle = run({ frames: 50, draws: () => false });
        expect(idle.owner.shadowDraws).toBe(0);
        expect(idle.shadow.needsUpdate).toBe(true);
        expect(() => redrawStaticShadow({}, null)).not.toThrow();
    });

    it('is how every static shadow map in the themes takes its first redraws', () => {
        const files = [
            'fall/fall-light.js', 'forest/forest-light.js', 'golden-forest/golden-forest-light.js',
            'halcyon-apex/halcyon-apex-world.js', 'sakura-twilight/sakura-light.js', 'summer/summer-light.js',
            'verdant-hills/verdant-hills-light.js',
        ];
        for (const rel of files) {
            const src = readFileSync(new URL(`../../src/themes/${rel}`, import.meta.url), 'utf8');
            expect(src, rel).toContain('redrawStaticShadow(this, this.');
            expect(src, rel).not.toMatch(/shadowFrames < 10/);
            const resets = src.match(/this\.shadowFrames = 0;\s*this\.shadowDraws = 0;/g) ?? [];
            expect(resets.length, rel).toBe((src.match(/this\.shadowFrames = 0;/g) ?? []).length);
        }
    });
});

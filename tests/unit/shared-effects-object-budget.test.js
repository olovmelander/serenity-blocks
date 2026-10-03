import { describe, expect, it, vi } from 'vitest';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';

describe('SharedEffects display object budgets', () => {
    it.each([
        ['_trackGraphics', 'activeGraphics', 'maxGraphicsObjects'],
        ['_trackText', 'activeTextObjects', 'maxTextObjects'],
    ])('evicts live objects and skips already destroyed objects with %s', (track, active, budget) => {
        const scene = {};
        const effects = new SharedEffects(scene);
        effects[budget] = 2;
        const oldest = { scene, destroy: vi.fn() };
        const detached = { scene: undefined, destroy: vi.fn() };
        const recent = { scene, destroy: vi.fn() };
        const next = { scene, destroy: vi.fn() };
        effects[track](oldest);
        effects[track](detached);
        effects[track](recent);
        expect(oldest.destroy).toHaveBeenCalledOnce();
        effects[track](next);
        expect(detached.destroy).not.toHaveBeenCalled();
        expect(effects[active]).toEqual([recent, next]);
    });
});

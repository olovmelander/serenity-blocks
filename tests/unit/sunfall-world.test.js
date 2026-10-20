import { describe, expect, it } from 'vitest';
import { SunfallWorld } from '../../src/themes/sunfall/sunfall-world.js';
import { SunfallDirector } from '../../src/themes/sunfall/sunfall-director.js';
import { SUNFALL_CLEAR, SUNFALL_PARTS } from '../../src/themes/sunfall/sunfall-core.js';
import { SUNFALL_QUALITY_ORDER } from '../../src/themes/sunfall/sunfall-quality.js';

describe('sunfall-world', () => {
    it('constructs all 9 named part groups and sets the chamber haze background color', () => {
        const world = new SunfallWorld({ quality: 'High' });
        expect(world.scene.background.getHex()).toBe(SUNFALL_CLEAR);
        expect([...world.partGroups.keys()]).toEqual(SUNFALL_PARTS);

        for (const part of SUNFALL_PARTS) {
            const g = world.partGroups.get(part);
            expect(g).toBeDefined();
            expect(g.children.length).toBeGreaterThan(0);
        }

        world.dispose();
        expect(world.partGroups.size).toBe(0);
    });

    it('filters visible parts via setParts() and restores all parts when passed null', () => {
        const world = new SunfallWorld({ quality: 'Medium' });
        world.setParts('cave,beam,jungle');
        expect(world.partGroups.get('cave').visible).toBe(true);
        expect(world.partGroups.get('beam').visible).toBe(true);
        expect(world.partGroups.get('jungle').visible).toBe(true);
        expect(world.partGroups.get('birds').visible).toBe(false);
        expect(world.partGroups.get('gours').visible).toBe(false);

        world.setParts(null);
        for (const g of world.partGroups.values()) {
            expect(g.visible).toBe(true);
        }
        world.dispose();
    });

    it('applies director snapshots to uniforms, beam pivot orientation, and delayed-greening shoots', () => {
        const world = new SunfallWorld({ quality: 'High' });
        const director = new SunfallDirector({ level: 1 });

        director.onLineClear({ lines: 4, rows: [16, 17, 18, 19], codes: ['I', 'S', 'Z', 'L'] });
        let snap;
        for (let i = 0; i < 4; i += 1) {
            snap = director.step(0.2);
        }
        world.applySnapshot(snap);

        expect(world.u.time.value).toBeCloseTo(0.8, 4);
        expect(world.u.rainbowStrength.value).toBeGreaterThan(0.85);
        expect(world.shootMetaAttr).toBeDefined();
        expect(world.beamPivot.quaternion.length()).toBeCloseTo(1.0, 4);

        world.dispose();
    });

    it('scales geometry and instance budgets across all 6 quality tiers without errors', () => {
        for (const tier of SUNFALL_QUALITY_ORDER) {
            const world = new SunfallWorld({ quality: tier });
            expect(world.preset.tier).toBe(tier);
            world.setAspect(1920, 1080);
            expect(world.camera.aspect).toBeCloseTo(16 / 9, 4);
            world.dispose();
        }
    });
});

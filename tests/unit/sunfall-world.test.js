import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import { SunfallWorld } from '../../src/themes/sunfall/sunfall-world.js';
import { SunfallDirector } from '../../src/themes/sunfall/sunfall-director.js';
import { SUNFALL_CLEAR, SUNFALL_PARTS } from '../../src/themes/sunfall/sunfall-core.js';
import { SUNFALL_QUALITY_ORDER } from '../../src/themes/sunfall/sunfall-quality.js';
import { loadSunfallAssetsFromDisk } from './helpers/sunfall-assets-disk.js';

vi.setConfig({ testTimeout: 60_000 });

describe('sunfall-world', () => {
    let world;
    beforeAll(async () => {
        world = new SunfallWorld({ quality: 'High', assets: await loadSunfallAssetsFromDisk() });
    });
    afterAll(() => world?.dispose());

    it('builds all nine parts from the authored doline', () => {
        expect(world.scene.background.getHex()).toBe(SUNFALL_CLEAR);
        expect([...world.partGroups.keys()]).toEqual(SUNFALL_PARTS);
        for (const part of SUNFALL_PARTS) {
            const group = world.partGroups.get(part);
            let meshes = 0;
            group.traverse((o) => { if (o.isMesh) meshes += 1; });
            expect(meshes, part).toBeGreaterThan(0);
        }
        // Every crown of the plan the High tier keeps across six instanced variants, plus the
        // surface forest round the oculus rim (its trunks drawn by one more instanced mesh).
        let crowns = 0;
        world.partGroups.get('jungle').traverse((o) => { if (o.isInstancedMesh && o.geometry.attributes.aCrown) crowns += o.count; });
        expect(crowns).toBeGreaterThan(world.assets.plan.count + 40);
        expect(crowns).toBeLessThan(world.assets.plan.count + 80);
    });

    it('lays an understory under the crowns, cut away past the forest\'s edge', () => {
        const layer = world.partGroups.get('jungle').getObjectByName('sunfall-understory');
        expect(layer).toBeTruthy();
        const mask = layer.geometry.attributes.aMask.array;
        const pos = layer.geometry.attributes.position.array;
        let kept = 0;
        for (let i = 0; i < mask.length; i += 1) {
            if (mask[i] < 0.5) continue;
            kept += 1;
            // Between the shrubs of a clearing and the crowns' undersides, over the floor.
            expect(pos[i * 3 + 1]).toBeGreaterThan(-160);
            expect(pos[i * 3 + 1]).toBeLessThan(-75);
        }
        // Most of the floor grid is forest, but not its corners outside the chamber.
        expect(kept / mask.length).toBeGreaterThan(0.3);
        expect(kept / mask.length).toBeLessThan(0.95);
    });

    it('filters parts and restores them all', () => {
        world.setParts('cave,beam,jungle');
        expect(world.partGroups.get('cave').visible).toBe(true);
        expect(world.partGroups.get('birds').visible).toBe(false);
        expect(world.isPartVisible('gours')).toBe(false);
        world.setParts(null);
        for (const g of world.partGroups.values()) expect(g.visible).toBe(true);
    });

    it('blends the two stations the sun is between and follows the foot of the column', () => {
        const director = new SunfallDirector({ level: 1 });
        director.stationCurrent = 1.25;
        director.stationLocked = 1.25;
        const snap = director.step(0);
        world.applySnapshot(snap);
        const w = world.u.stationW.value;
        const total = w.x + w.y + w.z + w.w + world.u.stationW4.value;
        expect(total).toBeCloseTo(1, 6);
        expect(w.y).toBeGreaterThan(w.z);
        expect(w.z).toBeGreaterThan(0);
        expect(world.u.foot.value.y).toBeLessThan(-90);
    });

    it('opens a lock\'s leaves on the strand on its side and ripens them when their row clears', () => {
        const director = new SunfallDirector({ level: 1 });
        director.resetSession();
        world.applySnapshot(director.step(0));
        director.onPieceLock({ code: 'L', u: 0.1, row: 12 });
        world.applySnapshot(director.step(1 / 60));
        const { leafMesh } = world.life.strands;
        const C = leafMesh.geometry.attributes.aLeafC.array;
        const B = leafMesh.geometry.attributes.aLeafB.array;
        const piece = [];
        for (let i = 0; i < C.length / 4; i += 1) if (C[i * 4] === 6) piece.push(i);
        expect(piece).toHaveLength(4);
        // On the left strands (the piece locked in the left half of the board).
        for (const i of piece) expect(B[i * 4 + 2]).toBe(-1);
        director.onLineClear({ lines: 1, rows: [12] });
        world.applySnapshot(director.step(1 / 60));
        const ripened = piece.filter((i) => C[i * 4 + 3] < 1e5);
        expect(ripened.length).toBeGreaterThan(0);
    });

    it('holds the camera still under reduced motion', () => {
        const director = new SunfallDirector({ level: 1, reducedMotion: true });
        world.applySnapshot(director.step(3));
        const a = world.camera.position.clone();
        world.applySnapshot(director.step(5));
        expect(world.camera.position.distanceTo(a)).toBeLessThan(1e-6);
    });

    it('builds at every tier, and without its assets', () => {
        for (const tier of SUNFALL_QUALITY_ORDER) {
            const bare = new SunfallWorld({ quality: tier });
            expect(bare.preset.tier).toBe(tier);
            bare.setAspect(1920, 1080);
            expect(bare.camera.aspect).toBeCloseTo(16 / 9, 4);
            expect(bare.partGroups.get('cave').children).toHaveLength(0);
            expect(bare.partGroups.get('roots').children.length).toBeGreaterThan(0);
            bare.dispose();
        }
    });
});

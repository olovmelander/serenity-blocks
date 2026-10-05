import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createChiralGoldSculpture } from '../../src/themes/chiral-gold/chiral-gold-sculpture.js';

function create(quality = 'High') {
    return createChiralGoldSculpture({ scene: new THREE.Scene(), quality, random: () => 0.5 });
}
function advance(sculpture, seconds) {
    for (let t = 0; t < seconds; t += 1 / 60) sculpture.update(t, 1 / 60);
}

describe('Chiral Gold reaction timing and ownership', () => {
    it('finishes a lock impact before a clear flourish and a hero reaction', () => {
        const lock = create();
        const clear = create();
        const hero = create();
        try {
            lock.trigger('lock', 1, { x: -100, y: -400 });
            clear.trigger('clear', 1);
            hero.trigger('tetris', 1);
            for (const sculpture of [lock, clear, hero]) advance(sculpture, 1);
            expect(lock.diagnostics().activeHalos).toBe(0);
            expect(clear.diagnostics().activeHalos).toBe(1);
            expect(hero.diagnostics().activeHalos).toBe(2);
            advance(clear, 0.6);
            advance(hero, 0.6);
            expect(clear.diagnostics().activeHalos).toBe(0);
            expect(hero.diagnostics().activeHalos).toBe(2);
        } finally { lock.dispose(); clear.dispose(); hero.dispose(); }
    });

    it('uses the locked side and stages the opposite combo arc after the first', () => {
        const sculpture = create();
        try {
            sculpture.trigger('lock', 1, { x: 100, y: -400 });
            sculpture.update(8, 1 / 60);
            expect(sculpture.diagnostics().reactions[0].side).toBe(1);
            sculpture.resetReactions();
            sculpture.trigger('combo', 1.8);
            sculpture.update(8, 1 / 60);
            const reactions = sculpture.diagnostics().reactions;
            expect(reactions.map(({ side }) => side)).toEqual([-1, 1]);
            expect(reactions[0].opacity).toBeGreaterThan(0);
            expect(reactions[1].opacity).toBe(0);
            advance(sculpture, 0.2);
            expect(sculpture.diagnostics().reactions.every(({ opacity }) => opacity > 0)).toBe(true);
        } finally { sculpture.dispose(); }
    });

    it('adds a row front without allocating a second hero flourish', () => {
        const sculpture = create('Minimal');
        try {
            sculpture.trigger('combo', 1.8);
            sculpture.trigger('clear-front', 1, { x: 0, y: -400 });
            expect(sculpture.diagnostics().activeHalos).toBe(2);
            expect(sculpture.diagnostics().activeTravelFronts).toBe(2);
            advance(sculpture, 2.8);
            expect(sculpture.diagnostics().activeHalos).toBe(0);
            expect(sculpture.diagnostics().activeTravelFronts).toBe(0);
        } finally { sculpture.dispose(); }
    });

    it('keeps a running reaction at the peripheral sculpture when the viewport changes', () => {
        const sculpture = create('Low');
        try {
            sculpture.resize(1440, 900);
            sculpture.trigger('combo', 1.8, { x: 0, y: -400 });
            advance(sculpture, 0.3);
            sculpture.resize(390, 844);
            sculpture.update(8.3, 0);
            const camera = new THREE.PerspectiveCamera(64, 390 / 844, 1, 10000);
            camera.position.set(0, 0, 1520);
            camera.updateMatrixWorld();
            const halos = sculpture.root.children.filter((object) => object.name === 'ChiralGold / pooled event corona' && object.visible);
            for (const halo of halos) {
                const position = halo.getWorldPosition(new THREE.Vector3()).project(camera);
                expect(Math.abs(position.x)).toBeGreaterThan(0.6);
                expect(Math.abs(position.x)).toBeLessThan(1.1);
                expect(Number.isFinite(position.y)).toBe(true);
            }
        } finally { sculpture.dispose(); }
    });

    it('replays a centered lock on the same side after deterministic reset', () => {
        const sculpture = create();
        try {
            sculpture.trigger('lock', 1);
            const side = sculpture.diagnostics().reactions[0].side;
            sculpture.resetReactions();
            sculpture.trigger('lock', 1);
            expect(sculpture.diagnostics().reactions[0].side).toBe(side);
        } finally { sculpture.dispose(); }
    });
});

import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import AstralWeaveTheme from '../../src/themes/astral-weave/astral-weave-theme.js';
import {
    AstralWeaveWorld, bakeAstralCloudTexture, buildAstralRibbonCurve, buildAstralSilkGeometry, getAstralWeaveLayout,
} from '../../src/themes/astral-weave/astral-weave-world.js';

describe('Astral Weave silk composition', () => {
    it('emits celebration rings from the transformed portrait loom', () => {
        const theme = new AstralWeaveTheme();
        theme.rootGroup = new THREE.Group();
        theme.rootGroup.scale.x = getAstralWeaveLayout(390 / 844).span;
        theme.rootGroup.rotation.set(0.02, 0.03, -0.04);
        theme.rootGroup.position.set(0.3, 0.8, -0.2);
        theme.nexusGroup = new THREE.Group();
        theme.nexusGroup.position.copy(theme.nexusLocalPosition);
        theme.rootGroup.add(theme.nexusGroup);
        theme.rootGroup.updateMatrixWorld(true);
        const expected = theme.nexusLocalPosition.clone().applyMatrix4(theme.rootGroup.matrixWorld);
        expect(theme.getNexusWorldPosition().distanceTo(expected)).toBeLessThan(0.000001);
        theme.clock.dispose();
    });

    it('reserves the gold crown ripple when several events arrive together', () => {
        const theme = new AstralWeaveTheme();
        const spawn = vi.spyOn(theme, 'spawnShockwave').mockImplementation(() => {});
        for (let i = 0; i < 20; i += 1) {
            theme.fxController.onLineClear(4);
            theme.fxController.onCombo(8);
        }
        theme.spawnPendingReactiveEffects();
        expect(spawn).toHaveBeenCalledTimes(2);
        expect(spawn.mock.calls[0][1]).toBe(true);
        expect(spawn.mock.calls[1][1]).toBeUndefined();
        theme.clock.dispose();
    });

    it('keeps paired arcs beside the board and preserves a usable portrait span', () => {
        const landscape = getAstralWeaveLayout(16 / 9);
        const portrait = getAstralWeaveLayout(390 / 844);
        expect(landscape.span).toBe(1);
        expect(portrait.span).toBeGreaterThan(0.25);
        expect(portrait.span).toBeLessThan(0.4);
        for (let i = 0; i < 14; i += 1) {
            const curve = buildAstralRibbonCurve(i, 14);
            expect(curve.getPoint(0).y).toBeGreaterThan(20);
            expect(Math.abs(curve.points[2].x) * portrait.span).toBeGreaterThan(5);
            expect(curve.getPoint(1).y).toBeLessThan(-30);
        }
    });

    it('builds finite folded surfaces with continuous longitudinal UVs', () => {
        for (let i = 0; i < 10; i += 1) {
            const geometry = buildAstralSilkGeometry(buildAstralRibbonCurve(i, 10), 64, 2.2, i * 0.7);
            try {
                expect(geometry.getAttribute('position').array.every(Number.isFinite)).toBe(true);
                expect(geometry.getAttribute('normal').array.every(Number.isFinite)).toBe(true);
                const uv = geometry.getAttribute('uv');
                expect(uv.getX(0)).toBe(0);
                expect(uv.getX(uv.count - 1)).toBe(1);
                expect(geometry.index.array.every((index) => index < uv.count)).toBe(true);
                expect(geometry.boundingSphere.radius).toBeGreaterThan(20);
            } finally { geometry.dispose(); }
        }
    });

    it('uses the same cloud field when lowering texture resolution', () => {
        const low = bakeAstralCloudTexture(32);
        const high = bakeAstralCloudTexture(128);
        try {
            for (const [x, y] of [[0, 0], [12, 5], [31, 31]]) {
                const a = (y * 32 + x) * 4;
                const b = (y * 4 * 128 + x * 4) * 4;
                expect(Array.from(low.image.data.slice(a, a + 4)))
                    .toEqual(Array.from(high.image.data.slice(b, b + 4)));
            }
        } finally { low.dispose(); high.dispose(); }
    });

    it('releases its texture and instanced anchors once after repeated teardown', () => {
        const scene = new THREE.Scene();
        const root = new THREE.Group(); scene.add(root);
        const world = new AstralWeaveWorld(scene, root, new THREE.Vector3(4, 21, -24)).build();
        const resources = [world.cloudTexture, ...world.objects.flatMap((object) => [object.geometry, object.material])];
        const dispose = resources.map((resource) => vi.spyOn(resource, 'dispose'));
        const anchors = scene.getObjectByName('astral-constellation-jewels');
        expect(anchors.isInstancedMesh).toBe(true);
        expect(anchors.count).toBe(96);
        const disposeAnchors = vi.spyOn(anchors, 'dispose');
        world.update(8, { crownPulse: 0.7, weaveCharge: 0.4, eventHue: 1 }, new THREE.PerspectiveCamera());
        expect(world.uniforms.crown.value).toBe(0.7);
        world.dispose(); world.dispose();
        expect(scene.children).toEqual([root]);
        expect(root.children).toHaveLength(0);
        dispose.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
        expect(disposeAnchors).toHaveBeenCalledOnce();
    });
});

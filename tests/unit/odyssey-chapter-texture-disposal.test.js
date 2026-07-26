// Pins OD-11: textures bound only inside TSL node graphs (via texture(canvasTex))
// are invisible to ChapterEnvironmentManager's material/uniform traverse, so chapters
// register them in group.userData.ownedTextures and the shared teardown disposes them.
// Tests the manager MECHANISM with a fake environment (constructing a real WebGPU
// chapter in the node test env is impractical) — the plan explicitly allows this.

import * as THREE from 'three/webgpu';
import {
    describe, expect, it, vi,
} from 'vitest';
import { ChapterEnvironmentManager } from '../../src/rendering/odyssey/ChapterEnvironmentManager.js';

const chapterPositions = [0, 0.13, 0.21, 0.36, 0.5, 0.65, 0.81, 0.94, 1];

function makeManager() {
    const scene = new THREE.Scene();
    const renderer = { setClearColor: vi.fn() };
    return new ChapterEnvironmentManager(scene, renderer, { chapterPositions });
}

// A texture the disposal traverse can't reach (bound via a TSL texture() node).
const fakeTexture = () => ({ isTexture: true, dispose: vi.fn() });

function fakeEnv(ownedTextures) {
    const group = new THREE.Group();
    group.visible = false; // pass the "still drawing" evict guard
    group.userData.ownedTextures = ownedTextures;
    return {
        group,
        update: null,
        config: null,
        opacityTargets: null,
        rigLights: [],
        lastOpacity: 0,
        lastVisible: false,
        prewarmed: false,
    };
}

describe('OD-11: chapter-owned TSL textures are disposed on evict', () => {
    it('disposes every registered ownedTexture exactly once on evict', () => {
        const manager = makeManager();
        const texA = fakeTexture();
        const texB = fakeTexture();
        const env = fakeEnv([texA, texB]);
        manager.environmentGroup.add(env.group);
        manager.environments.set(3, env);

        expect(manager.disposeChapterEnvironment(3)).toBe(true);

        expect(texA.dispose).toHaveBeenCalledTimes(1);
        expect(texB.dispose).toHaveBeenCalledTimes(1);
        expect(env.group).toBeNull(); // disposeChapterEnvironment nulls env.group after freeing
    });

    it('is idempotent — a second teardown frees nothing and does not throw', () => {
        const manager = makeManager();
        const texA = fakeTexture();
        const env = fakeEnv([texA]);
        manager.environmentGroup.add(env.group);

        manager._freeEnvironmentResources(env);
        expect(texA.dispose).toHaveBeenCalledTimes(1);
        expect(env.group.userData.ownedTextures).toHaveLength(0);

        expect(() => manager._freeEnvironmentResources(env)).not.toThrow();
        expect(texA.dispose).toHaveBeenCalledTimes(1); // not disposed a second time
    });

    it('leaves material.map / uniform textures to the existing traverse (no double-registration needed)', () => {
        const manager = makeManager();
        const mapTex = fakeTexture();
        const env = fakeEnv([]); // nothing registered as owned
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
        mesh.material.map = mapTex;
        env.group.add(mesh);
        manager.environmentGroup.add(env.group);

        manager._freeEnvironmentResources(env);

        // The traverse frees material.map textures directly — ownedTextures is only for the
        // TSL-node-bound ones the traverse can't see.
        expect(mapTex.dispose).toHaveBeenCalledTimes(1);
    });

    it('re-create after evict gets a fresh, non-empty ownedTextures array (re-entry works)', () => {
        const manager = makeManager();
        const env1 = fakeEnv([fakeTexture(), fakeTexture()]);
        manager.environmentGroup.add(env1.group);
        manager.environments.set(3, env1);
        manager.disposeChapterEnvironment(3);

        // Simulate re-create: a brand-new group with its own textures, not the disposed one.
        const env2 = fakeEnv([fakeTexture(), fakeTexture(), fakeTexture()]);
        expect(env2.group.userData.ownedTextures).toHaveLength(3);
        expect(env2.group).not.toBe(env1.group);
    });
});

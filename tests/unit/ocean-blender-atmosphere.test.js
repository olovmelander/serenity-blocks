import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OceanAtmosphereSystem } from '../../src/themes/ocean/ocean-atmosphere-system.js';
import { loadGltfCached } from '../../src/themes/ocean/ocean-asset-loader.js';
import { disposeReefCausticTexture } from '../../src/themes/ocean/ocean-caustics.js';

vi.mock('../../src/themes/ocean/ocean-asset-loader.js', () => ({ loadGltfCached: vi.fn() }));
const systems = [];
const placements = ['purple-tube-sponge', 'branching-coral', 'table-coral', 'table-coral']
    .map((kind, index) => ({
        kind, x: index * 12, y: -20, z: -10, scale: 1, ry: 0,
    }));

async function parseModel(url) {
    const filename = new URL(url, 'http://localhost').pathname.split('/').pop();
    const bytes = readFileSync(new URL(`../../src/themes/ocean/assets/blender-reef/${filename}`, import.meta.url));
    return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

function createSystem() {
    const system = new OceanAtmosphereSystem({
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(),
        preset: { atmosphere: { blenderAssets: true } },
        getSeabedHeight: () => -20,
        isWebGPU: true,
    });
    system.scene.add(system.group);
    system.heroCorals = placements.map(() => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
        system.group.add(mesh);
        return mesh;
    });
    systems.push(system);
    return system;
}

afterEach(() => {
    systems.splice(0).forEach((system) => system.dispose());
    vi.restoreAllMocks();
    vi.mocked(loadGltfCached).mockReset();
    disposeReefCausticTexture();
});

describe('Ocean authored reef integration', () => {
    it('retains a failed colony while loading and reporting the other real models', async () => {
        const system = createSystem();
        const fallback = system.heroCorals[1];
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.mocked(loadGltfCached).mockImplementation((url) => (
            url.includes('staghorn') ? Promise.reject(new Error('fixture unavailable')) : parseModel(url)
        ));
        await system.upgradeHeroCoralsFromGLB(placements);
        expect(system.heroCorals[1]).toBe(fallback);
        expect(fallback.parent).toBe(system.group);
        expect(system.heroCorals[0].userData.assetId).toBe('atelier-sponge');
        expect(system.heroCorals[2].userData.assetId).toBe('atelier-fan');
        expect(system.heroCorals[3].userData.assetId).toBe('atelier-foliose');
        const signoff = system.collectSignoff();
        expect(signoff.heroCorals.glbLoadedCount).toBe(3);
        expect(signoff.heroCorals.loadedCount).toBe(3);
        expect(signoff.heroCorals.manifest.every((record) => record.id.startsWith('atelier-'))).toBe(true);
        expect(system.authoredMorphs[0].sample.authored).toBe(true);
    });

    it('animates authored fan and kelp weights and releases instanced morph resources', async () => {
        const system = createSystem();
        vi.mocked(loadGltfCached).mockImplementation(parseModel);
        await system.upgradeHeroCoralsFromGLB(placements);
        await system.upgradeHeroKelpFromGLB(placements.slice(0, 2));
        expect(system.authoredMorphs).toHaveLength(3);
        const [fan, kelp, otherKelp] = system.authoredMorphs.map((state) => state.mesh);
        system.update(0.5);
        const firstFan = [...fan.morphTargetInfluences];
        const firstKelp = [...kelp.morphTargetInfluences];
        system.update(2.1);
        expect(fan.morphTargetInfluences).not.toEqual(firstFan);
        expect(kelp.morphTargetInfluences).not.toEqual(firstKelp);
        expect(kelp.morphTargetInfluences).not.toEqual(otherKelp.morphTargetInfluences);
        expect(system.collectSignoff().heroKelp.manifest[0].id).toBe('atelier-ribbon-kelp');
        const dispose = vi.spyOn(fan, 'dispose');
        system.dispose();
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(system.authoredMorphs).toHaveLength(0);
    });

    it('disposes a completed model load after its atmosphere was stopped', async () => {
        const system = createSystem();
        let resolveLoad;
        vi.mocked(loadGltfCached).mockImplementation(() => new Promise((resolve) => { resolveLoad = resolve; }));
        const pending = system.upgradeHeroCoralsFromGLB(placements.slice(0, 1));
        const gltf = await parseModel('http://localhost/coral-sponge.glb');
        const mesh = gltf.scene.children[0];
        const dispose = vi.spyOn(mesh.geometry, 'dispose');
        system.dispose();
        resolveLoad(gltf);
        await pending;
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(system.heroCorals).toHaveLength(0);
    });
});

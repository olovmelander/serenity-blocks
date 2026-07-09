import * as THREE from 'three/webgpu';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { ChapterEnvironmentManager } from './ChapterEnvironmentManager.js';

describe('ChapterEnvironmentManager atmosphere seams', () => {
    const chapterPositions = [0, 0.13, 0.21, 0.36, 0.5, 0.65, 0.81, 0.94, 1];

    it('bridges scene fog through the Surface to Mountains boundary', () => {
        const scene = new THREE.Scene();
        const renderer = { setClearColor: vi.fn() };
        const manager = new ChapterEnvironmentManager(scene, renderer, { chapterPositions });

        manager.updateGlobalEnvironment(0.36);

        expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
        expect(scene.fog.color.getHex()).toBe(0x638699);
        expect(scene.fog.density).toBeCloseTo(0.0024, 5);
        expect(renderer.setClearColor).toHaveBeenCalled();
        expect(renderer.setClearColor.mock.calls.at(-1)[0].getHex()).toBe(0x527da2);
    });
});

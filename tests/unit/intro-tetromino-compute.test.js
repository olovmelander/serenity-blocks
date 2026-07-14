import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { IntroTetrominoCompute } from '../../src/ui/intro-tetromino-compute.js';
import ThreeJSIntroRendererWebGPU from '../../src/ui/threejs-intro-renderer-webgpu.js';

function spawn(compute, x = 0) {
    return compute.spawn(x, 0, 0, 0.05, 0, 0, 0);
}

function fillPool(compute, setNow) {
    for (let slot = 0; slot < IntroTetrominoCompute.MAX_TETROMINOS; slot++) {
        setNow(slot * 1000);
        expect(spawn(compute, slot)).toBe(slot);
    }
}

describe('intro tetromino title avoidance', () => {
    it('stays enabled by default and can be disabled independently of title effects', () => {
        const visual = new ThreeJSIntroRendererWebGPU(null);

        expect(visual.uTetrominoTitleAvoidance.value).toBe(1);
        visual.setTetrominoTitleAvoidanceEnabled(false);
        expect(visual.uTetrominoTitleAvoidance.value).toBe(0);
        expect(visual.titleEffectsEnabled).toBe(true);
        visual.setTetrominoTitleAvoidanceEnabled(true);
        expect(visual.uTetrominoTitleAvoidance.value).toBe(1);
    });

    it('wires the title-avoidance uniform into the instanced position node', () => {
        const visual = new ThreeJSIntroRendererWebGPU(null);
        visual.scene = new THREE.Scene();
        visual.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
        visual.camera.position.z = 40;
        visual.initTetrominoCompute();
        visual.initCachedResources();
        visual.initTetrominoInstancing();

        let uniformIsReferenced = false;
        visual.cachedResources.I.material.positionNode.traverse((node) => {
            if (node === visual.uTetrominoTitleAvoidance) uniformIsReferenced = true;
        });

        expect(uniformIsReferenced).toBe(true);
        visual.destroy();
    });
});

describe('intro tetromino recycling', () => {
    const computes = [];

    afterEach(() => {
        computes.splice(0).forEach((compute) => compute.dispose());
        vi.restoreAllMocks();
    });

    function createCompute() {
        const compute = new IntroTetrominoCompute();
        computes.push(compute);
        return compute;
    }

    it('keeps oldest-first recycling as the intro default', () => {
        const compute = createCompute();
        let now = 0;
        compute._getNow = vi.fn(() => now);
        fillPool(compute, (value) => { now = value; });

        now = 50_000;
        expect(spawn(compute, 999)).toBe(0);
        expect(compute.positionData[0]).toBe(999);
    });

    it('skips full-pool spawns until the minimum residence time has elapsed', () => {
        const compute = createCompute();
        let now = 0;
        compute._getNow = vi.fn(() => now);
        compute.setRecyclingPolicy({
            mode: 'minimum-residence',
            minimumResidenceMs: 120_000,
        });
        fillPool(compute, (value) => { now = value; });
        const originalFirstSlot = compute.positionData.slice(0, 4);

        now = 119_999;
        expect(spawn(compute, 999)).toBe(-1);
        expect(compute.positionData.slice(0, 4)).toEqual(originalFirstSlot);

        now = 120_000;
        expect(spawn(compute, 999)).toBe(0);
        expect(compute.positionData[0]).toBe(999);
    });

    it('uses a CPU-known inactive slot without waiting for residence expiry', () => {
        const compute = createCompute();
        let now = 0;
        compute._getNow = vi.fn(() => now);
        compute.setRecyclingPolicy({
            mode: 'minimum-residence',
            minimumResidenceMs: 120_000,
        });
        fillPool(compute, (value) => { now = value; });
        compute.positionData[17 * 4 + 3] = 0;

        now = 50_000;
        expect(spawn(compute, 999)).toBe(17);
        expect(compute.positionData[17 * 4]).toBe(999);
    });

    it('normalizes theme policy before compute initialization', () => {
        const visual = new ThreeJSIntroRendererWebGPU(null);

        expect(visual.setTetrominoRecyclingPolicy({
            mode: 'minimum-residence',
            minimumResidenceMs: -50,
        })).toEqual({
            mode: 'minimum-residence',
            minimumResidenceMs: 0,
        });
        expect(visual.tetrominoRecyclingPolicy).toEqual({
            mode: 'minimum-residence',
            minimumResidenceMs: 0,
        });
    });
});

import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    disposeReefCausticTexture, getReefCausticTexture, getReefFloorTexture,
} from '../../src/themes/ocean/ocean-caustics.js';

afterEach(() => disposeReefCausticTexture());

describe('Ocean baked texture cache lifetime', () => {
    it('shares live textures, disposes once, and recreates deterministic data after eviction', () => {
        const light = getReefCausticTexture();
        const floor = getReefFloorTexture();
        expect(getReefCausticTexture()).toBe(light);
        expect(getReefFloorTexture()).toBe(floor);
        const lightDispose = vi.fn();
        const floorDispose = vi.fn();
        light.addEventListener('dispose', lightDispose);
        floor.addEventListener('dispose', floorDispose);
        const lightBytes = light.image.data.slice();
        const floorBytes = floor.image.data.slice();
        disposeReefCausticTexture();
        disposeReefCausticTexture();
        expect(lightDispose).toHaveBeenCalledTimes(1);
        expect(floorDispose).toHaveBeenCalledTimes(1);
        const rebuiltLight = getReefCausticTexture();
        const rebuiltFloor = getReefFloorTexture();
        expect(rebuiltLight).not.toBe(light);
        expect(rebuiltFloor).not.toBe(floor);
        expect(rebuiltLight.image.data).toEqual(lightBytes);
        expect(rebuiltFloor.image.data).toEqual(floorBytes);
        expect(rebuiltLight.version).toBeGreaterThan(0);
        expect(rebuiltFloor.version).toBeGreaterThan(0);
    });
});

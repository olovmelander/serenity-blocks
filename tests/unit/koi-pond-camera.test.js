import {
    describe, expect, it, vi,
} from 'vitest';

import { createKoiPondCameraDirector } from '../../src/themes/koi-pond/rendering/koi-pond-camera.js';
import { KOI_POND_LAYOUT } from '../../src/themes/koi-pond/rendering/koi-pond-layout.js';

function makeCamera() {
    const position = {
        x: 4,
        y: 5,
        z: 6,
        set(x, y, z) {
            this.x = x;
            this.y = y;
            this.z = z;
        },
        clone() {
            return { x: this.x, y: this.y, z: this.z };
        },
        copy(value) {
            Object.assign(this, value);
        },
    };
    return {
        position,
        quaternion: {
            clone: () => ({ initial: true }),
            copy: vi.fn(),
        },
        fov: 55,
        near: 0.5,
        far: 80,
        lookAt: vi.fn(),
        updateProjectionMatrix: vi.fn(),
    };
}

describe('Koi Pond camera director', () => {
    it('critically damps pointer intent into the bounded authored pose', () => {
        const camera = makeCamera();
        const director = createKoiPondCameraDirector({ camera });
        director.apply();
        director.setPointer(1, 1);

        for (let frame = 0; frame < 120; frame += 1) {
            director.update(frame / 60, 1 / 60);
        }

        expect(camera.position.x).toBeCloseTo(
            KOI_POND_LAYOUT.camera.position.x
                + KOI_POND_LAYOUT.camera.parallax.position.x,
            2,
        );
        expect(camera.position.y).toBeCloseTo(
            KOI_POND_LAYOUT.camera.position.y
                + KOI_POND_LAYOUT.camera.parallax.position.y,
            2,
        );
    });

    it('snaps to rest and ignores new pointer input under reduced motion', () => {
        const camera = makeCamera();
        const director = createKoiPondCameraDirector({ camera });
        director.setPointer(1, -1);
        director.update(0, 0.2);
        director.setReducedMotion(true);
        director.setPointer(-1, 1);
        director.update(1, 1 / 60);

        expect(camera.position.x).toBeCloseTo(KOI_POND_LAYOUT.camera.position.x);
        expect(camera.position.y).toBeCloseTo(KOI_POND_LAYOUT.camera.position.y);
        expect(director.getDiagnostics().pointer).toEqual({ x: 0, y: 0 });
    });

    it('applies deterministic capture poses and narrows horizontal travel in portrait', () => {
        const camera = makeCamera();
        camera.aspect = 0.7;
        const director = createKoiPondCameraDirector({ camera });

        director.setPointer(1, -0.5, { immediate: true });

        expect(director.getDiagnostics().current.x).toBe(1);
        expect(camera.position.x).toBeCloseTo(
            KOI_POND_LAYOUT.camera.position.x
                + KOI_POND_LAYOUT.camera.parallax.position.x * 0.58,
        );
        expect(camera.position.y).toBeLessThan(KOI_POND_LAYOUT.camera.position.y);
    });
});

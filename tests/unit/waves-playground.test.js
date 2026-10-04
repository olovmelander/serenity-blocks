import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { create } from '../../src/playground/effects/waves.effect.js';
import { seededRandom } from '../../src/utils/helpers.js';

let bench;
afterEach(() => {
    bench?.dispose();
    vi.unstubAllGlobals();
});

function setup(query = '') {
    vi.stubGlobal('window', { innerWidth: 1440, innerHeight: 900 });
    vi.stubGlobal('document', { querySelector: () => null });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 240);
    bench = create({
        scene,
        camera,
        renderer: { render: vi.fn(), toneMapping: THREE.NoToneMapping, toneMappingExposure: 1 },
        params: new URLSearchParams(`quality=Low&t=8&event=combo&combo=7&${query}`),
        rng: seededRandom(187),
    });
    return window.__WAVES_OCEAN__;
}

function impacts(ocean) {
    return ocean.impactData.map((data) => data.toArray());
}

describe('Waves deterministic playground seek', () => {
    it('replays identical impacts after backward and forward seeks', () => {
        const ocean = setup();
        bench.seek(8);
        const expected = impacts(ocean);
        const expectedPulse = ocean.pulse.value;
        expect(expected.some((data) => data[3] > 0)).toBe(true);
        bench.seek(3);
        bench.seek(8);
        expect(impacts(ocean)).toEqual(expected);
        expect(ocean.pulse.value).toBe(expectedPulse);
        bench.seek(8);
        expect(impacts(ocean)).toEqual(expected);
    });

    it('keeps an event at zero age and ignores invalid seek times', () => {
        const ocean = setup('eventAge=0');
        bench.seek(8);
        const expected = impacts(ocean);
        expect(expected.some((data) => data[3] > 0)).toBe(true);
        bench.seek(NaN);
        bench.seek(Infinity);
        expect(impacts(ocean)).toEqual(expected);
        expect(ocean.time.value).toBe(8);
    });
});

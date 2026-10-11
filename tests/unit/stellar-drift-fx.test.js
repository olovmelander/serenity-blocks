import { describe, expect, it } from 'vitest';
import { uniform } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { createResonances, RESONANCE_SLOTS } from '../../src/themes/stellar-drift/stellar-drift-fx.js';

function makeResonances() {
    return createResonances({
        time: uniform(0),
        pixelAngle: uniform(0.001),
        camPos: uniform(new THREE.Vector3(0, 1, 5)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
    });
}

describe('stellar drift orbital effects', () => {
    it('bounds a sustained event storm without creating more geometry or materials', () => {
        const fx = makeResonances();
        const { geometry, material, mesh } = fx;
        const kinds = ['sweep', 'helix', 'crown'];
        for (let i = 0; i < 200; i++) {
            fx.emit({ time: 12, kind: kinds[i % 3], rgb: [0.4, 0.8, 1], seed: i });
        }
        expect(fx.getState(12.5).active).toBe(RESONANCE_SLOTS);
        expect(fx.getState(12.5).emitted).toBe(200);
        expect(Object.values(fx.getState(12.5).kinds).every((count) => count > 0)).toBe(true);
        expect(fx.geometry).toBe(geometry);
        expect(fx.material).toBe(material);
        expect(fx.mesh).toBe(mesh);
        // A stalled frame retires events directly from their timestamps; no update loop needed.
        expect(fx.getState(120).active).toBe(0);
        geometry.dispose();
        material.dispose();
    });

    it('waits for scheduled echoes and drops them on a session reset', () => {
        const fx = makeResonances();
        fx.emit({ time: 5, kind: 'sweep', rgb: [1, 0.8, 0.3] });
        fx.emit({ time: 6, kind: 'crown', rgb: [0.4, 1, 0.9], motion: 0.2 });
        expect(fx.getState(4).active).toBe(0);
        expect(fx.getState(5.2).active).toBe(1);
        expect(fx.getState(6.2).active).toBe(2);
        fx.reset();
        expect(fx.getState(6.2)).toEqual({ active: 0, emitted: 0, kinds: { sweep: 0, helix: 0, crown: 0 } });
        fx.geometry.dispose();
        fx.material.dispose();
    });
});

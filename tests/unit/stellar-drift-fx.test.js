import { describe, expect, it } from 'vitest';
import { uniform } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { createHeads, createMeteors } from '../../src/themes/stellar-drift/stellar-drift-fx.js';
import { METEOR_SLOTS } from '../../src/themes/stellar-drift/stellar-drift-core.js';

function makeUniforms() {
    return {
        time: uniform(0),
        pixelAngle: uniform(0.001),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        camPos: uniform(new THREE.Vector3(0, 1, 5)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
    };
}

const flight = (i, over = {}) => ({
    from: new THREE.Vector3(3, 2, 1),
    to: new THREE.Vector3(0.6, 0, 0.8),
    birth: 10 + i * 0.01,
    flight: 0.6,
    rgb: [0.4, 0.8, 1],
    size: 1,
    mote: false,
    ...over,
});

describe('stellar drift flights', () => {
    it('bounds a sustained storm of flights without creating more geometry or materials', () => {
        const u = makeUniforms();
        const meteors = createMeteors(u);
        const heads = createHeads(u, meteors);
        const { geometry, material, mesh } = meteors;
        for (let i = 0; i < 200; i++) meteors.launch(flight(i));
        expect(meteors.geometry).toBe(geometry);
        expect(meteors.material).toBe(material);
        expect(meteors.mesh).toBe(mesh);
        // Every slot is drawn always (idle ones collapse), and the heads read the same table.
        expect(geometry.instanceCount).toBe(METEOR_SLOTS);
        expect(heads.geometry.instanceCount).toBe(METEOR_SLOTS);
        expect(meteors.table.array).toHaveLength(METEOR_SLOTS * 4);
        // The newest flights hold the slots.
        const births = meteors.table.array.filter((_, i) => i % 4 === 0).map((row) => row.w);
        expect(Math.max(...births)).toBeCloseTo(10 + 199 * 0.01, 6);
        expect(Math.min(...births)).toBeGreaterThan(10);
        [meteors, heads].forEach((part) => {
            part.geometry.dispose();
            part.material.dispose();
        });
    });

    it('flies a lock\'s mote on a rising arc and a meteor straight, and drops both on a reset', () => {
        const u = makeUniforms();
        const meteors = createMeteors(u);
        meteors.launch(flight(0, { mote: true }));
        meteors.launch(flight(1));
        const rows = meteors.table.array;
        const chordMid = new THREE.Vector3(3, 2, 1).lerp(new THREE.Vector3(0.6, 0, 0.8), 0.5);
        // Slot 0: a mote (kind 1), its control point lifted above the chord.
        expect(rows[3].w).toBe(1);
        expect(rows[3].y).toBeGreaterThan(chordMid.y + 0.1);
        // Slot 1: a meteor (kind 0), its control point on the chord.
        expect(rows[7].w).toBe(0);
        expect(rows[7].y).toBeCloseTo(chordMid.y, 6);
        meteors.reset();
        for (let i = 0; i < METEOR_SLOTS; i++) expect(rows[i * 4].w).toBeLessThan(-1e5);
        meteors.geometry.dispose();
        meteors.material.dispose();
    });
});

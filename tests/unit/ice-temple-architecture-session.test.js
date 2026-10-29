import { describe, expect, it } from 'vitest';
import { createArchitecture } from '../../src/themes/ice-temple/ice-temple-architecture.js';
import { buildPlan } from '../../src/themes/ice-temple/ice-temple-plan.js';
import { createNoiseTexture, createTempleUniforms } from '../../src/themes/ice-temple/ice-temple-tsl.js';

/**
 * Ice Temple built its columns, ribs, crystals and icicles again on every start (30-50 ms of main
 * thread). The same plan builds the same ice, so it is kept for the session under the plan's seed;
 * each start still gets geometry objects of its own.
 */
describe('Ice Temple keeps its architecture for the session', () => {
    const u = createTempleUniforms({ noise: createNoiseTexture() });

    it('builds the same ice once, and hands each start its own geometry over the kept arrays', () => {
        const a = createArchitecture(u, buildPlan(), { veils: 2, sessionKey: 'test' });
        const b = createArchitecture(u, buildPlan(), { veils: 3, sessionKey: 'test' });
        expect(b.geometry).not.toBe(a.geometry);
        for (const name of ['position', 'normal', 'aSmooth', 'aInfo', 'aSt']) {
            expect(b.geometry.getAttribute(name).array).toBe(a.geometry.getAttribute(name).array);
        }
        expect(b.triangles).toBe(a.triangles);
        // Without a key it builds afresh: the same numbers, in arrays of its own.
        const fresh = createArchitecture(u, buildPlan(), { veils: 3 });
        expect(fresh.geometry.getAttribute('position').array).not.toBe(a.geometry.getAttribute('position').array);
        const bytes = (part, name) => Buffer.from(part.geometry.getAttribute(name).array.buffer);
        for (const name of ['position', 'normal', 'aSmooth', 'aInfo', 'aSt']) {
            expect(Buffer.compare(bytes(fresh, name), bytes(a, name))).toBe(0);
        }
        expect(fresh.triangles).toBe(a.triangles);
        [a, b, fresh].forEach((part) => {
            part.geometry.dispose();
            part.material.dispose();
        });
    }, 30_000);

    it('keeps another plan apart', () => {
        const a = createArchitecture(u, buildPlan(), { sessionKey: 'one' });
        const b = createArchitecture(u, buildPlan(7), { sessionKey: 'seven' });
        expect(b.geometry.getAttribute('position').array).not.toBe(a.geometry.getAttribute('position').array);
    });
});

/**
 * High Coast's ground round the eye: the summit is the land's own mesh drawn in two parts (its
 * nearest rows by a material of their own), the two parts share every post, nothing the summit's
 * material leaves out reaches the summit on the baked coast, and the boulders are broken blocks
 * that sit in the rock. CPU only.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    DEG, EYE, FIELDS, FIELD_ORDER, UPLIFT, liftAfter, relaxLift, upliftStep,
} from '../../src/themes/high-coast/high-coast-core.js';
import { planCoast } from '../../src/themes/high-coast/high-coast-assets.js';
import { decodeField, groundByte, groundHeight } from '../../src/themes/high-coast/high-coast-field.js';
import { FAN, SUMMIT, fanIndicesWithin } from '../../src/themes/high-coast/high-coast-land.js';
import { tierFor } from '../../src/themes/high-coast/high-coast-quality.js';
import { boulderGeometry } from '../../src/themes/high-coast/high-coast-props.js';
import { HighCoastWorld } from '../../src/themes/high-coast/high-coast-world.js';
import { decodePng } from '../../scripts/high-coast/png.mjs';

const assetUrl = (name) => new URL(`../../src/themes/high-coast/assets/${name}`, import.meta.url);

describe('High Coast summit', () => {
    it('takes the fan\'s nearest rows, whole strips of them, on every tier', () => {
        const lnNear = Math.log(FAN.near);
        const lnFar = Math.log(FAN.far);
        for (const quality of ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']) {
            const { fanCols: cols, fanRows: rows } = tierFor(quality);
            const count = fanIndicesWithin(cols, rows);
            expect(count % ((cols - 1) * 6), quality).toBe(0);
            const strips = count / ((cols - 1) * 6);
            expect(strips, quality).toBeGreaterThan(10);
            expect(strips, quality).toBeLessThan(rows - 1);
            const reachOf = (row) => Math.exp(lnNear + (lnFar - lnNear) * (row / (rows - 1)));
            // The last row it draws is within reach, the next one is not; its layers have faded by then.
            expect(reachOf(strips), quality).toBeLessThanOrEqual(SUMMIT.reach);
            expect(reachOf(strips + 1), quality).toBeGreaterThan(SUMMIT.reach);
            expect(reachOf(strips), quality).toBeGreaterThan(SUMMIT.fade[1]);
        }
        expect(SUMMIT.fade[0]).toBeLessThan(SUMMIT.fade[1]);
        expect(fanIndicesWithin(300, 270, 10)).toBeLessThan(fanIndicesWithin(300, 270, 40));
    });

    it('draws the land in two parts that share every post and split the index between them', () => {
        const world = new HighCoastWorld({
            scene: new THREE.Scene(), quality: 'Low', capture: true, prepared: HighCoastWorld.prepareSync('Low', planCoast()),
        }).build();
        const tier = tierFor('Low');
        const [land, summit] = world.parts.land.meshes;
        expect(land).toBe(world.parts.land.mesh);
        expect(land.name).toBe('HighCoastLand');
        expect(summit.name).toBe('HighCoastSummit');
        expect(summit.material.name).toBe('HighCoastSummit');
        expect(summit.geometry.attributes.position).toBe(land.geometry.attributes.position);
        expect(summit.geometry.index).toBe(land.geometry.index);
        const nearest = fanIndicesWithin(tier.fanCols, tier.fanRows);
        expect(summit.geometry.drawRange).toEqual({ start: 0, count: nearest });
        expect(land.geometry.drawRange.start).toBe(nearest);
        expect(land.geometry.drawRange.count).toBe(Infinity);
        expect(land.renderOrder).toBe(summit.renderOrder);
        world.dispose();
    });

    it('stands clear of everything its material leaves out, on the baked coast', () => {
        const fields = {};
        for (const name of FIELD_ORDER) {
            const image = decodePng(readFileSync(assetUrl(`coast-${name}.png`)));
            fields[name] = { ...decodeField(image.rgba, FIELDS[name]), size: FIELDS[name].size, source: 'asset' };
        }
        fields.source = 'asset';
        const half = FAN.halfAngle * DEG;
        let lowest = Infinity;
        let forest = 0;
        for (let d = FAN.near; d <= SUMMIT.reach; d += 1) {
            for (let k = 0; k <= 96; k += 1) {
                const a = -half + (2 * half * k) / 96;
                const x = EYE.x + Math.sin(a) * d;
                const z = EYE.z - Math.cos(a) * d;
                lowest = Math.min(lowest, groundHeight(fields, x, z, true));
                forest = Math.max(forest, groundByte(fields, 'flow', x, z));
            }
        }
        // No shore, no risen band, no wet line (the sea is a hundred metres down), no forest.
        expect(lowest).toBeGreaterThan(60);
        expect(forest).toBeLessThan(0.02);
    });
});

describe('High Coast boulders', () => {
    it('are broken blocks: the same one every time, with faces, sitting on a flattened base', () => {
        const a = boulderGeometry();
        const b = boulderGeometry();
        const p = a.attributes.position;
        expect(Array.from(p.array)).toEqual(Array.from(b.attributes.position.array));
        let top = -Infinity;
        let bottom = Infinity;
        let far = 0;
        let nearest = Infinity;
        const v = new THREE.Vector3();
        for (let i = 0; i < p.count; i += 1) {
            v.fromBufferAttribute(p, i);
            expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
            top = Math.max(top, v.y);
            bottom = Math.min(bottom, v.y);
            far = Math.max(far, v.length());
            nearest = Math.min(nearest, v.length());
        }
        // The breaks took something off, and left a block.
        expect(far).toBeLessThan(1.25);
        expect(nearest).toBeGreaterThan(0.3);
        expect(far / nearest).toBeGreaterThan(1.5);
        // It stands taller than it is sunk.
        expect(top).toBeGreaterThan(0.55);
        expect(bottom).toBeGreaterThan(-0.7);
        expect(top).toBeGreaterThan(-bottom);
        const n = a.attributes.normal;
        for (let i = 0; i < n.count; i += 37) expect(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1)).toBeLessThan(1e-3);
        a.dispose();
        b.dispose();
    });
});

describe('High Coast sea level under play', () => {
    /** The asked lift over a run: a clear every `every` seconds, each `quadEvery`th one four lines. */
    function run(every, quadEvery = 0, seconds = 300) {
        let ask = 0;
        let peak = 0;
        let sum = 0;
        let n = 0;
        let next = every;
        let k = 0;
        for (let t = 0; t < seconds; t += 0.1) {
            ask = relaxLift(ask, 0.1);
            if (t >= next) {
                k += 1;
                const lines = quadEvery && k % quadEvery === 0 ? 4 : 1;
                ask = liftAfter(ask, upliftStep(lines, 1));
                next += every * lines;
            }
            if (t > 60) {
                sum += ask;
                n += 1;
                peak = Math.max(peak, ask);
            }
        }
        return { mean: sum / n, peak };
    }

    it('never drains the bays: the sea stays within a few metres of rest however one plays', () => {
        // The strait below the summit is bare seabed at twenty metres down; nine keeps it a strait.
        expect(UPLIFT.ceiling).toBeLessThanOrEqual(10);
        const steady = run(60 / 16);
        expect(steady.mean).toBeGreaterThan(2);
        expect(steady.mean).toBeLessThan(5);
        const fast = run(60 / 30, 3);
        expect(fast.peak).toBeLessThan(8.5);
        expect(fast.mean).toBeLessThan(7);
        // Even a chain of the longest clears only approaches the ceiling.
        let ask = 0;
        for (let i = 0; i < 40; i += 1) ask = liftAfter(ask, upliftStep(4, UPLIFT.chainCap + 1));
        expect(ask).toBeLessThanOrEqual(UPLIFT.ceiling);
    });

    it('still shows every clear: a line bares a band of rock, four lines a few metres at once', () => {
        expect(upliftStep(1, 1)).toBeGreaterThanOrEqual(0.6);
        const quad = liftAfter(3, upliftStep(4, 1)) - 3;
        expect(quad).toBeGreaterThan(2.5);
        // And the sea is back within about a minute of the last clear.
        expect(relaxLift(6, 60)).toBeLessThan(1);
    });
});

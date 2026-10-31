import { describe, expect, it } from 'vitest';
import {
    buildCloudFieldGeometry,
    validateCloudFieldClearance,
} from './odyssey-cloud-field.js';
import { CLOUD_FIELD_CLEARANCE, ODYSSEY_CLOUD_FIELD_SPECS } from './odyssey-cloud-field-specs.js';
import {
    ODYSSEY_CLOUD_LOOK_DEFAULT, ODYSSEY_CLOUD_LOOKS, cloudFieldSpecsForLook, resolveCloudLook,
} from './odyssey-cloud-looks.js';
import { getOdysseyPathPointAt } from '../path-utils.js';

// The same rail window as odyssey-cloud-field.test.js: only where the world is drawn.
const ACT_START = 0.063;
const ACT_END = 0.678;
const RAIL = Array.from(
    { length: 400 },
    (_, i) => getOdysseyPathPointAt(ACT_START + ((i / 399) * (ACT_END - ACT_START))),
);

describe('cloud looks', () => {
    it('wears the default look when none (or an unknown one) is asked for, and keeps today one lever away', () => {
        expect(resolveCloudLook(undefined).id).toBe(ODYSSEY_CLOUD_LOOK_DEFAULT);
        expect(resolveCloudLook('nonsense').id).toBe(ODYSSEY_CLOUD_LOOK_DEFAULT);
        expect(resolveCloudLook('today')).toBe(ODYSSEY_CLOUD_LOOKS.today);
        expect(resolveCloudLook('today').paint).toBeNull();
        expect(cloudFieldSpecsForLook(resolveCloudLook('today'))).toBe(ODYSSEY_CLOUD_FIELD_SPECS);
        expect(cloudFieldSpecsForLook(resolveCloudLook('light'))).toBe(ODYSSEY_CLOUD_FIELD_SPECS);
    });

    it('paints banks as light', () => {
        expect(resolveCloudLook('banks').paint).toBe(ODYSSEY_CLOUD_LOOKS.light.paint);
        expect(resolveCloudLook('BANKS').layout).toBe('banks');
    });

    it('banks drop the smallest puff of each satellite cluster and the banner (now a plume), keep the zenith', () => {
        const banks = cloudFieldSpecsForLook(resolveCloudLook('banks'), undefined, RAIL);
        const shipped = new Map(ODYSSEY_CLOUD_FIELD_SPECS.map((s) => [s.id, s]));
        const kept = new Set(banks.map((s) => s.id));
        const gone = ODYSSEY_CLOUD_FIELD_SPECS.filter((s) => !kept.has(s.id)).map((s) => s.id);
        expect(gone).toEqual(['O04', 'A04', 'A08', 'A09', 'A10', 'A11', 'A12', 'A13', 'B1-banner-root', 'B2-banner-tail']);
        // The shower's rain cloud stands in their place.
        expect(banks.filter((s) => s.role === 'shower').length).toBeGreaterThan(2);
        banks.filter((s) => s.role !== 'shower').forEach((s) => {
            const was = shipped.get(s.id);
            expect(s.base).toBe(was.base);
            if (/^Z\d/.test(s.id)) expect(s).toBe(was);
            else expect(s.w).toBeGreaterThan(was.w);
        });
    });

    it('banks clear the live rail by every role margin', () => {
        const banks = cloudFieldSpecsForLook(resolveCloudLook('banks'), undefined, RAIL);
        expect(validateCloudFieldClearance(banks, RAIL, CLOUD_FIELD_CLEARANCE)).toEqual([]);
    });

    it('banks stay inside the field triangle budget', () => {
        const banks = cloudFieldSpecsForLook(resolveCloudLook('banks'), undefined, RAIL);
        const build = buildCloudFieldGeometry(banks, RAIL);
        expect(build.triangles).toBeLessThan(34000);
        build.geometry.dispose();
    });
});

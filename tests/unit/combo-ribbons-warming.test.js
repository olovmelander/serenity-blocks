import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { SummerGarlands } from '../../src/themes/summer/summer-garlands.js';
import { GoldenForestRibbons } from '../../src/themes/golden-forest/golden-forest-ribbons.js';

/**
 * Summer's garlands and Golden Forest's ribbons draw (at zero strength) for their first frames, so
 * their pipelines exist before the first combo. A theme switched in during play is built hidden and
 * its builds are budgeted per frame, so the ribbons may be reached only after those frames: they
 * compiled on the first combo instead, a 0.37 s stall (play-feel probe, 2026-10-15). They now also
 * draw for as long as their theme says it is warming (built hidden: world.setWarming).
 */
describe.each([
    ['summer garlands', SummerGarlands],
    ['golden-forest ribbons', GoldenForestRibbons],
])('%s while their theme is built hidden', (name, Ribbons) => {
    const make = () => {
        const ribbons = new Ribbons({ light: {}, tier: { ribbons: 2 } });
        ribbons.group.add(new THREE.Object3D(), new THREE.Object3D());
        return ribbons;
    };
    const shown = (ribbons) => ribbons.group.children.map((child) => child.visible);

    it('draws past its first frames while warming, and hides once the theme is revealed', () => {
        const ribbons = make();
        ribbons.warming = true;
        for (let frame = 0; frame < 30; frame += 1) {
            ribbons.update({ ribbons: 0 });
            expect(shown(ribbons)).toEqual([true, true]);
        }
        ribbons.warming = false;
        ribbons.update({ ribbons: 0 });
        expect(shown(ribbons)).toEqual([false, false]);
    });

    it('still draws for its first frames only when nothing says it is warming', () => {
        const ribbons = make();
        const seen = [];
        for (let frame = 0; frame < 6; frame += 1) {
            ribbons.update({ ribbons: 0 });
            seen.push(shown(ribbons)[0]);
        }
        expect(seen).toEqual([true, true, true, false, false, false]);
        ribbons.update({ ribbons: 0.5 });
        expect(shown(ribbons)).toEqual([true, true]);
    });
});

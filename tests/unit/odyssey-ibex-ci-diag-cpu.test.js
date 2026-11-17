// DIAGNOSTIC ONLY (do not merge): which machine ran this job, and do the perch rocks build right
// when only the boulders and the ground are loaded (none of the ibex test's other imports)?
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildPerchTops } from '../../src/rendering/odyssey/world/odyssey-boulders.js';
import { odysseyWorldHeight } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { describePerchFailure } from './helpers/odyssey-perch-diag.js';

describe('CI machine', () => {
    it('says which CPU and Node ran the suite', () => {
        const cpu = os.cpus()?.[0];
        console.log(`CI-DIAG-CPU ${process.version} ${process.arch} ${cpu?.model} x${os.cpus().length} ${cpu?.speed}MHz flags:${process.config?.variables?.v8_enable_pointer_compression}`);
        expect(cpu).toBeTruthy();
    });

    it('builds the perch rocks with nothing else loaded', () => {
        const perch = buildPerchTops(odysseyWorldHeight);
        for (const [px, pz] of [[-150, -558.5], [-158.5, -556.5], [-144, -566.5]]) {
            const proud = perch.topAt(px, pz) - odysseyWorldHeight(px, pz);
            const why = proud > 0.6 ? '' : describePerchFailure(perch, odysseyWorldHeight, [px, pz]);
            console.log(`CI-DIAG-MINIMAL (${px}, ${pz}) ${proud}`);
            expect(proud, `minimal perch (${px}, ${pz})${why}`).toBeGreaterThan(0.6);
        }
    });
});

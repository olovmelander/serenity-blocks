import { describe, expect, it } from 'vitest';
import { FAR_PEAKS, farRidgesAt } from '../../src/themes/himalayan-peak/himalayan-peak-sky.js';
import { planHeight } from '../../src/themes/himalayan-peak/himalayan-peak-massif.js';
import { EYE, SUN_AZIMUTH } from '../../src/themes/himalayan-peak/himalayan-peak-core.js';

/**
 * The far range is painted in the sky beyond the headwall. It must rise over the headwall's
 * skyline where its giants stand (or it is never seen), and stay under it round the sun's bearing
 * (or it hides the sunrise the chain is built around).
 */
const DEG = Math.PI / 180;

/** The near skyline's elevation (degrees) at a bearing (degrees right of the view axis). */
function skyline(bearing) {
    const az = bearing * DEG;
    let best = -90;
    for (let d = 300; d < 16000; d += 60) {
        const h = planHeight(Math.sin(az) * d, -Math.cos(az) * d);
        best = Math.max(best, Math.atan2(h - EYE.y, d) / DEG);
    }
    return best;
}

describe('Himalayan Peak far range', () => {
    it('rises over the headwall where each giant stands', () => {
        for (const [bearing] of FAR_PEAKS) {
            const [top] = farRidgesAt(bearing);
            expect(top - skyline(bearing)).toBeGreaterThan(0.8);
        }
    });

    it('shows the second range through the intervening cols', () => {
        for (const col of [-8.9, -2.1, 5, 14.8, 20]) {
            const [front, , back] = farRidgesAt(col);
            expect(back - Math.max(front, skyline(col))).toBeGreaterThan(0.25);
        }
    });

    it('stays under the near skyline round the sunrise', () => {
        const sun = SUN_AZIMUTH / DEG;
        for (let b = sun - 5; b <= sun + 5; b += 1) {
            const [front, , back] = farRidgesAt(b);
            expect(Math.max(front, back)).toBeLessThan(skyline(b));
        }
    });
});

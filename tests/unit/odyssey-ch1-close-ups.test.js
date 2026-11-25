// CHAPTER 1'S CLOSE-UPS LOOK INTO THE SHAFT (2026-11-25): down across the shaft onto the lava lake,
// from a different side at each orb, instead of north into the shaft's wall.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
    CH1_CLOSE_UPS, CH1_CLOSE_UP_UNTIL, resolveCh1CloseUp,
} from '../../src/rendering/odyssey/odyssey-ch1-close-ups.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';

const layout = getLevelRegistry().getPresentationLayout();
const local = (id) => layout.levelPositionsById[id] / layout.chapterPositions[1];

describe('chapter 1\'s close-ups', () => {
    it('look down onto the lake from the chapter\'s first four orbs', () => {
        for (const id of [1, 2, 3, 4]) {
            const view = resolveCh1CloseUp(local(id));
            expect(view, `orb ${id}`).not.toBeNull();
            expect(view.length()).toBeCloseTo(1, 6);
            const down = THREE.MathUtils.radToDeg(Math.asin(-view.y));
            expect(down, `orb ${id} looks down`).toBeGreaterThan(25);
            expect(down, `orb ${id} keeps the far wall in frame`).toBeLessThan(45);
        }
    });

    it('are four pictures: no two neighbours look the same way', () => {
        for (const id of [1, 2, 3]) {
            const a = resolveCh1CloseUp(local(id));
            const b = resolveCh1CloseUp(local(id + 1));
            expect(THREE.MathUtils.radToDeg(a.angleTo(b)), `orbs ${id} and ${id + 1}`).toBeGreaterThan(40);
        }
    });

    it('leave the orb at the sea\'s floor its shared view, and every key an orb to use it', () => {
        expect(resolveCh1CloseUp(local(5))).toBeNull();
        expect(local(5)).toBeGreaterThan(CH1_CLOSE_UP_UNTIL);
        expect(resolveCh1CloseUp(Number.NaN)).toBeNull();
        CH1_CLOSE_UPS.forEach((key, i) => expect(Math.abs(key.t - local(i + 1)), `key ${i}`).toBeLessThan(0.03));
    });
});

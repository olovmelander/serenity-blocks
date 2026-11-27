// CHAPTER 1'S CLOSE-UPS LOOK INTO THE SHAFT (2026-11-25): down across the shaft onto the lava lake,
// from a different side at each orb, instead of north into the shaft's wall. The last orb, at the
// vent's lip, looks back down the throat (2026-11-27: it parks in the lava's light, not in the sea).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CH1_CLOSE_UPS, resolveCh1CloseUp } from '../../src/rendering/odyssey/odyssey-ch1-close-ups.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';

const layout = getLevelRegistry().getPresentationLayout();
const local = (id) => layout.levelPositionsById[id] / layout.chapterPositions[1];
const downOf = (view) => THREE.MathUtils.radToDeg(Math.asin(-view.y));

describe('chapter 1\'s close-ups', () => {
    it('look down onto the lake from the chapter\'s first four orbs', () => {
        for (const id of [1, 2, 3, 4]) {
            const view = resolveCh1CloseUp(local(id));
            expect(view, `orb ${id}`).not.toBeNull();
            expect(view.length()).toBeCloseTo(1, 6);
            expect(downOf(view), `orb ${id} looks down`).toBeGreaterThan(25);
            expect(downOf(view), `orb ${id} keeps the far wall in frame`).toBeLessThan(45);
        }
    });

    it('look back down the throat from the last orb, at the vent\'s lip', () => {
        // From the lip the lake is far below: a view across (the shared one) met the lip's flat rock.
        const view = resolveCh1CloseUp(local(5));
        expect(view).not.toBeNull();
        expect(view.length()).toBeCloseTo(1, 6);
        expect(downOf(view)).toBeGreaterThan(60);
        expect(downOf(view), 'not straight down the rail').toBeLessThan(80);
    });

    it('are five pictures: no two neighbours look the same way', () => {
        for (const id of [1, 2, 3, 4]) {
            const a = resolveCh1CloseUp(local(id));
            const b = resolveCh1CloseUp(local(id + 1));
            expect(THREE.MathUtils.radToDeg(a.angleTo(b)), `orbs ${id} and ${id + 1}`).toBeGreaterThan(40);
        }
    });

    it('give every orb a key of its own, and nothing outside the chapter', () => {
        expect(CH1_CLOSE_UPS).toHaveLength(5);
        CH1_CLOSE_UPS.forEach((key, i) => expect(Math.abs(key.t - local(i + 1)), `key ${i}`).toBeLessThan(0.03));
        expect(resolveCh1CloseUp(Number.NaN)).toBeNull();
        expect(resolveCh1CloseUp(-0.01)).toBeNull();
        expect(resolveCh1CloseUp(1.01)).toBeNull();
    });
});

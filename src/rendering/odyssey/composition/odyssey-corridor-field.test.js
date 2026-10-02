import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { OdysseyCorridorField } from './odyssey-corridor-field.js';
import { computeStageBasis } from './odyssey-stage-frame.js';
import {
    getActiveOdysseyChapterPositions,
    getChapterPathRange,
    getOdysseyPathCurve,
} from '../path-utils.js';
import { seamHalfWidth } from '../transitions/odyssey-seam-schedule.js';

describe('OdysseyCorridorField — the finale (2026-10)', () => {
    const scene = new THREE.Scene();
    const field = new OdysseyCorridorField(scene);
    const urban = field._chapters.find((record) => record.chapterId === 8);
    const positions = getActiveOdysseyChapterPositions();

    it('holds the final chapter at full strength to the journey end (no fade past p=1)', () => {
        const mid = (positions[7] + 1) / 2;
        expect(field._visibilityWeight(urban.bounds, 1, 8)).toBe(1);
        expect(field._visibilityWeight(urban.bounds, mid + 0.002, 8)).toBeGreaterThan(0.99);
        // Other chapters keep their symmetric seam fades (ch7 is half-faded at its end).
        const ch7 = field._chapters.find((record) => record.chapterId === 7);
        const w7 = field._visibilityWeight(ch7.bounds, ch7.bounds.end, 7);
        expect(w7).toBeGreaterThan(0.3);
        expect(w7).toBeLessThan(0.7);
    });

    it('places the urban sheets AHEAD of the travel in the stage frame, facing the camera', () => {
        const stage = computeStageBasis(getOdysseyPathCurve(), positions[7], positions[8] ?? 1);
        const { center } = getChapterPathRange(8);
        const sheets = urban.layers.filter((layer) => !layer.follow);
        expect(sheets.length).toBeGreaterThan(0);
        sheets.forEach((layer) => {
            const ahead = layer.basePos.clone().sub(center).dot(stage.forward);
            expect(ahead).toBeGreaterThan(400);
            const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(layer.object.quaternion);
            expect(normal.dot(stage.forward)).toBeLessThan(-0.99);
        });
        field.dispose();
    });
});

describe('OdysseyCorridorField — seam windows follow the live seams (seamless pass 2026-10-02)', () => {
    const scene = new THREE.Scene();
    const field = new OdysseyCorridorField(scene);
    const positions = getActiveOdysseyChapterPositions();
    const record = (id) => field._chapters.find((r) => r.chapterId === id);
    const weight = (id, p) => field._visibilityWeight(record(id).bounds, p, id);

    it('keeps the neon corridor out of the black hole until the 7->8 window opens', () => {
        // Was 0.69 at p 0.9429 — before the window (0.9447) had even started.
        const start78 = positions[7] - seamHalfWidth(7);
        expect(weight(8, start78 - 0.0018)).toBe(0);
        expect(weight(8, start78)).toBe(0);
        expect(weight(8, positions[7])).toBeCloseTo(0.5, 2);
    });

    it('brings the cosmos in only after the 5->6 boundary (never in the summit daylight)', () => {
        // Was fading in from p 0.664, deep in chapter 5's daylight.
        expect(weight(6, positions[5] - 0.09)).toBe(0);
        expect(weight(6, positions[5])).toBe(0);
        expect(weight(6, positions[5] + seamHalfWidth(5))).toBe(1);
    });

    it('ends the chapter-1 embers inside the steam quench, not a third of the way up the ocean', () => {
        // Was still present at p 0.13.
        expect(weight(1, positions[1] + seamHalfWidth(1))).toBe(0);
        expect(weight(1, 0.13)).toBe(0);
        expect(weight(1, positions[1] - seamHalfWidth(1))).toBe(1);
        field.dispose();
    });
});

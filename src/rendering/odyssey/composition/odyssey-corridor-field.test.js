import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { OdysseyCorridorField } from './odyssey-corridor-field.js';
import { computeStageBasis } from './odyssey-stage-frame.js';
import {
    getActiveOdysseyChapterPositions,
    getChapterPathRange,
    getOdysseyPathCurve,
} from '../path-utils.js';

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

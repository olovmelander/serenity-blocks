/**
 * Thermal Bloom — how a steam column bends with the wind. A column is the path of the puffs that
 * left its vent: each height's puffs drifted with the wind they met since then, so a change in
 * the wind bends the column from the bottom up and a gust leaves a kink that climbs it, where the
 * old straight lean pivoted the whole column about its foot at once (the far columns "swayed
 * strangely"). Relations, never tuning numbers.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { REST_RIG, ThermalBloomWorld, fovForAspect } from '../../src/themes/thermal-bloom/thermal-bloom-world.js';
import {
    DRIFT, GUST_CROSS, VAPOUR_KIND, VAPOUR_ROWS_PER, gustAt, plumeDrift, rigidDrift, riseForLean,
    vapourDecode, windRunTable, windVelocity,
} from '../../src/themes/thermal-bloom/thermal-bloom-core.js';
import { fallbackLayout } from '../../src/themes/thermal-bloom/thermal-bloom-composition.js';

const CENTRE = [-102, -196];
const N = DRIFT.nodes;
const nodes = (out) => Array.from({ length: N }, (_, k) => [out[2 * k], out[2 * k + 1]]);
const angle = ([ax, az], [bx, bz]) => Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));

/** The first gust start after t (seconds), found from the schedule itself. */
function nextGust(t) {
    const g = { phase: -1, seed: 0 };
    let before = gustAt(t, g).phase;
    for (let s = t; s < t + 120; s += 0.05) {
        const now = gustAt(s, g).phase;
        if (now >= 0 && before < 0) return s;
        before = now;
    }
    throw new Error('no gust');
}

/** The drift with every gust left out: the breeze's run at each node's age. */
function runOnly(t, height, rise, run) {
    const T = height / rise;
    return Array.from({ length: N }, (_, k) => {
        const at = (T * ((k + 1) / N) ** DRIFT.bend) / DRIFT.step;
        const i = Math.floor(at);
        const f = at - i;
        return [0, 1].map((c) => run[2 * i + c] + (run[2 * (i + 1) + c] - run[2 * i + c]) * f);
    });
}

describe('Thermal Bloom steam: the wind’s history bends a column', () => {
    it('keeps the breeze’s run back from now, starting at the vent', () => {
        const run = windRunTable(40);
        expect(run[0]).toBe(0);
        expect(run[1]).toBe(0);
        const v = windVelocity(40);
        expect(run[2]).toBeCloseTo(v[0] * DRIFT.step, 1);
        expect(run[3]).toBeCloseTo(v[1] * DRIFT.step, 1);
        expect(Array.from(windRunTable(40))).toEqual(Array.from(run));
    });

    it('stands each height where the breeze carried its puffs, the drift growing up the column', () => {
        // A moment whose window holds no gust.
        const t = nextGust(20) - 0.5;
        const run = windRunTable(t);
        const out = plumeDrift(t, 300, -900, 260, 11, run, CENTRE, new Float32Array(2 * N));
        const expected = runOnly(t, 260, 11, run);
        nodes(out).forEach(([x, z], k) => {
            expect(x).toBeCloseTo(expected[k][0], 3);
            expect(z).toBeCloseTo(expected[k][1], 3);
        });
        const reach = nodes(out).map(([x, z]) => Math.hypot(x, z));
        for (let k = 1; k < N; k++) expect(reach[k]).toBeGreaterThan(reach[k - 1]);
    });

    it('curves where the wind has turned, where the old lean stood every column straight', () => {
        let curved = 0;
        const out = new Float32Array(2 * N);
        const straight = new Float32Array(2 * N);
        for (let t = 30; t < 230; t += 1) {
            plumeDrift(t, 300, -900, 300, 9, windRunTable(t), CENTRE, out);
            curved = Math.max(curved, angle(nodes(out)[0], nodes(out)[N - 1]));
            rigidDrift(t, 300, -900, 300, 0.1, CENTRE, -1, straight);
            expect(angle(nodes(straight)[0], nodes(straight)[N - 1])).toBeLessThan(1e-4);
        }
        // The top lags a turning wind by several degrees at some point of the cycle.
        expect(curved).toBeGreaterThan((3 * Math.PI) / 180);
    });

    it('leaves a gust’s kink in the puffs it pushed, climbing the column as they rise', () => {
        const start = nextGust(30);
        const front = start + GUST_CROSS / 2; // the front crosses the Iris's centre half way over
        const push = (t) => {
            const run = windRunTable(t);
            const out = plumeDrift(t, CENTRE[0], CENTRE[1], 260, 11, run, CENTRE, new Float32Array(2 * N));
            const base = runOnly(t, 260, 11, run);
            return nodes(out).map(([x, z], k) => Math.hypot(x - base[k][0], z - base[k][1]));
        };
        const just = push(front + 0.6);
        const later = push(front + 9);
        // Just after the front, the vent's puffs carry it; nine seconds on, they have risen past
        // the low nodes, which stand where the breeze alone puts them, while the top still holds it.
        expect(just[0]).toBeGreaterThan(2);
        expect(later[0]).toBeLessThan(just[0] * 0.1);
        expect(later[N - 1]).toBeGreaterThan(2);
    });

    it('never jumps from one frame to the next, gusts included', () => {
        const out = new Float32Array(2 * N);
        const prev = new Float32Array(2 * N);
        let worst = 0;
        for (let i = 0; i <= 60 * 120; i++) {
            const t = 20 + i / 60;
            plumeDrift(t, CENTRE[0], CENTRE[1], 260, 11, windRunTable(t), CENTRE, out);
            if (i > 0) for (let k = 0; k < 2 * N; k++) worst = Math.max(worst, Math.abs(out[k] - prev[k]));
            prev.set(out);
        }
        // About the gust's own push over a frame: never a step.
        expect(worst).toBeLessThan(DRIFT.gust / 60 + 0.05);
    });

    it('leans a body that moves as one by the current wind, straight and in proportion to height', () => {
        const out = rigidDrift(50, 300, -900, 100, 0.1, CENTRE, -1, new Float32Array(2 * N));
        const v = windVelocity(50);
        const speed = Math.hypot(v[0], v[1]);
        nodes(out).forEach(([x, z], k) => {
            const h = (100 * (k + 1)) / N;
            expect(Math.hypot(x, z)).toBeCloseTo(speed * 0.1 * h, 4);
            expect(angle([x, z], v)).toBeLessThan(1e-4);
        });
        expect(riseForLean(0.1)).toBeCloseTo(10, 6);
        expect(riseForLean(0)).toBe(DRIFT.rise[1]);
    });
});

describe('Thermal Bloom steam: the world writes every body’s axis', () => {
    it('writes finite axes, a trailing column’s growing with its height', () => {
        const scene = new THREE.Scene();
        const aspect = 16 / 9;
        const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
        const world = new ThermalBloomWorld({ scene, quality: 'Minimal', capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, aspect);
        world.setLayout(fallbackLayout(1600, 900), aspect);
        world.seek(40);
        const sim = {
            time: 40, delta: 0, pointerX: 0, pointerY: 0,
        };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
        const rows = world.u.tables.vapour;
        let plumes = 0;
        for (let i = 0; i < world.u.vapourCount.value; i++) {
            const o = i * VAPOUR_ROWS_PER;
            const axis = [rows[o + 3], rows[o + 4], rows[o + 5]].flatMap((r) => [[r.x, r.y], [r.z, r.w]]);
            axis.flat().forEach((v) => expect(Number.isFinite(v)).toBe(true));
            expect(rows[o + 1].w).toBeGreaterThan(0);
            if (vapourDecode(rows[o + 2].w).kind === VAPOUR_KIND.plume && rows[o].w > 100) {
                plumes += 1;
                expect(Math.hypot(...axis[N - 1])).toBeGreaterThan(Math.hypot(...axis[0]));
            }
        }
        expect(plumes).toBeGreaterThan(0);
        world.dispose();
    });
});

/**
 * Thermal Bloom — the effects never pop under quick play (2026-11-17). On the CPU: a real
 * ThermalBloomWorld, no renderer, stepped at 60 fps through a session of quick locks, hard drops,
 * clears and a chain.
 *
 * The owner found the steam and the effects popping while playing. The causes, each pinned here:
 * the march's slots were re-chosen by density every frame (bodies flicked in and out at the
 * limit); bodies took their billow seed from their index in a list (when an older one went, every
 * younger one changed shape); and drops were hashed from their burst's slot (a new burst shifted
 * every other one, and all their drops jumped). Now an event body has an identity, its admission
 * to the march eases, and its seed is its own.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { REST_RIG, ThermalBloomWorld, fovForAspect } from '../../src/themes/thermal-bloom/thermal-bloom-world.js';
import {
    BURST_CODE, BURST_KIND, BURST_SLOTS, VAPOUR_SLOTS, vapourDecode,
} from '../../src/themes/thermal-bloom/thermal-bloom-core.js';
import { fallbackLayout } from '../../src/themes/thermal-bloom/thermal-bloom-composition.js';

const DT = 1 / 60;

function makeWorld(quality = 'High', at = 60) {
    const scene = new THREE.Scene();
    const aspect = 16 / 9;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new ThermalBloomWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(1600, 900, aspect);
    world.setLayout(fallbackLayout(1600, 900), aspect);
    world.seek(at);
    return { world, camera };
}

function frame(world, camera, during = null) {
    const sim = {
        time: world.time + DT, delta: DT, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

/**
 * A quick hand: a lock every half second (every other one a hard drop), a clear every third,
 * for `seconds`; then `quiet` seconds more with no play, so every body lives out its life.
 */
function playBeat(world, n) {
    const row = 8 + ((n * 7) % 12);
    world.onLock({
        player: 0, rows: [row - 1, row], u: (n * 0.37) % 1, hardDrop: n % 2 === 0, distance: 12,
    });
    if (n % 3 === 0) {
        const lines = 1 + (n % 4);
        world.onClear({
            player: 0, lines, rows: Array.from({ length: lines }, (_, k) => 19 - k), combo: 0, cascade: 1,
        });
    }
}

function quickPlay(world, camera, seconds, watch, quiet = 0) {
    const steps = Math.round((seconds + quiet) / DT);
    const playSteps = Math.round(seconds / DT);
    let next = 0.5;
    let n = 0;
    for (let i = 0; i < steps; i++) {
        const beat = i < playSteps && i * DT >= next;
        if (beat) {
            next += 0.5;
            n += 1;
        }
        const k = n;
        frame(world, camera, beat ? () => playBeat(world, k) : null);
        watch(i);
    }
}

describe('Thermal Bloom: no pops under quick play', () => {
    it('never cuts a steam body while it shows, never jumps one, never changes its shape', () => {
        const { world, camera } = makeWorld();
        const seen = new Map(); // id -> { last density, peak, code, steps }
        const steps = []; // [id, |change|] per frame, judged against the body's whole-life peak
        const peaks = new Map();
        let vanished = 0;
        let reseeded = 0;
        let mostDrawn = 0;
        quickPlay(world, camera, 24, () => {
            const list = world._vapourList;
            mostDrawn = Math.max(mostDrawn, world.u.vapourCount.value);
            const now = new Set();
            list.forEach((b) => {
                if (!(b.id >= 0)) return;
                now.add(b.id);
                const s = seen.get(b.id);
                if (!s) {
                    seen.set(b.id, { density: b.density, peak: b.density, code: b.code });
                    return;
                }
                if (s.code !== b.code) reseeded += 1;
                s.peak = Math.max(s.peak, b.density);
                peaks.set(b.id, s.peak);
                steps.push([b.id, Math.abs(b.density - s.density)]);
                s.density = b.density;
            });
            seen.forEach((s, id) => {
                if (now.has(id)) return;
                if (s.density > 0.15 * s.peak && s.density > 0.05) vanished += 1;
                seen.delete(id);
            });
        }, 10);
        // (quick play raised plenty of event steam to judge)
        expect(peaks.size).toBeGreaterThan(30);
        expect(mostDrawn).toBeLessThanOrEqual(VAPOUR_SLOTS);
        expect(reseeded).toBe(0);
        expect(vanished).toBe(0);
        // No body's density moves by more than a fifth of its peak in one frame at 60 fps.
        let worstJump = 0;
        steps.forEach(([id, d]) => {
            worstJump = Math.max(worstJump, d / Math.max(peaks.get(id) || 0, 1e-3));
        });
        expect(worstJump).toBeLessThan(0.2);
        world.dispose();
    });

    it('gives each event body its own seed, kept while others come and go', () => {
        const { world, camera } = makeWorld();
        const codeOf = new Map();
        quickPlay(world, camera, 12, () => {
            world._vapourList.forEach((b) => {
                if (!(b.id >= 0)) return;
                if (!codeOf.has(b.id)) codeOf.set(b.id, b.code);
                expect(b.code).toBe(codeOf.get(b.id));
            });
        });
        // Many bodies, and their seeds spread (not all the same).
        const seeds = new Set([...codeOf.values()].map((c) => vapourDecode(c).seed));
        expect(codeOf.size).toBeGreaterThan(20);
        expect(seeds.size).toBeGreaterThan(10);
        world.dispose();
    });

    it('keeps the chain\'s fountains in the burst rows first, within the slots', () => {
        const { world, camera } = makeWorld();
        for (let link = 2; link <= 8; link++) {
            frame(world, camera, () => world.onCombo(link));
            for (let i = 0; i < 6; i++) frame(world, camera);
        }
        // Then a burst of quick locks on top of the live chain.
        for (let n = 0; n < 14; n++) {
            frame(world, camera, () => world.onLock({
                player: 0, rows: [11, 12], u: (n * 0.29) % 1, hardDrop: true, distance: 14,
            }));
            for (let i = 0; i < 4; i++) frame(world, camera);
        }
        const n = world.u.burstCount.value;
        expect(n).toBeLessThanOrEqual(BURST_SLOTS);
        const rows = world.u.tables.bursts;
        const kindOf = (i) => {
            const code = Math.round(rows[i * 2 + 1].w);
            const rest = code - Math.floor(code / BURST_CODE.life) * BURST_CODE.life;
            return rest - Math.floor(rest / BURST_CODE.scale) * BURST_CODE.scale;
        };
        const live = world.ladder.filter((v) => !(v.out > v.start));
        expect(live.length).toBeGreaterThan(3);
        for (let i = 0; i < live.length; i++) expect(kindOf(i)).toBe(BURST_KIND.fountain);
        world.dispose();
    });
});

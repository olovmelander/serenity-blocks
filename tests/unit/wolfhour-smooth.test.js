import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { createWolfhourPack } from '../../src/themes/wolfhour/wolfhour-wolves.js';
import { CAPSULE_COUNT, CAPSULE_STRIDE } from '../../src/themes/wolfhour/wolfhour-wolf-rig.js';
import { WolfhourNightDirector } from '../../src/themes/wolfhour/wolfhour-night-director.js';
import { SNOW_DEVIL, createWolfhourSnow } from '../../src/themes/wolfhour/wolfhour-snow.js';
import { VOICE, createWolfhourVoices } from '../../src/themes/wolfhour/wolfhour-voices.js';
import WolfhourTheme from '../../src/themes/wolfhour/wolfhour-theme.js';

/**
 * Wolfhour under busy play: every event looks right on its own; the pops came from events meeting
 * (a howl as a traveller sets off, a fever's chorus quicker than a note, a band of moonlight or a
 * ripple still lit when the next one wanted its slot, energy stepped straight into the light).
 * These replay such play frame by frame and ask that nothing steps, cuts or nods.
 */
vi.setConfig({ testTimeout: 60_000 });

const owners = [];
const own = (owner) => {
    owners.push(owner);
    return owner;
};
afterEach(() => {
    for (const owner of owners.splice(0).reverse()) owner?.dispose?.();
});

const RIDGE = Object.freeze({ left: -723, right: 191 });

describe('Wolfhour under busy play', () => {
    it('lets no wolf pop: nothing jumps a frame, no howl steps, no head nods in a fever chorus', () => {
        const pack = own(createWolfhourPack());
        const ridge = (x) => Math.sin(x * 0.05) * 6 + x * 0.06;
        pack.settle(ridge);
        pack.answerer.settle(ridge);
        pack.scout.settle(ridge, RIDGE);
        pack.far.settle(ridge);
        pack.summit.settle(ridge);
        const calls = [];
        // A quad while the scout stands at its lookout, a moment before it turns and trots off
        // (the howl held its turn back and let go at once: it snapped round in one frame).
        calls.push([43.5, 'howl'], [43.5, 'summon']);
        // Clears through the hunt's visit: the ridge's wolves glance as far as they have settled.
        for (let t = 66; t < 114; t += 1.7) calls.push([t, 'glance']);
        // A fever: the chorus every 2.2 s, quicker than a note (each used to dip every head).
        for (let t = 120; t < 160; t += 2.2) calls.push([t, 'howl'], [t, 'summon']);
        // A quad as the note falls, then back to back across the valley, then a combo.
        calls.push([166, 'howl'], [169.5, 'howl'], [169.5, 'answer'], [175, 'excite']);
        calls.sort((a, b) => a[0] - b[0]);

        const ends = (wolf) => {
            if (!wolf.mesh.visible || wolf.fade < 0.5) return null;
            const { x: sx, y: sy } = wolf.mesh.scale;
            const { x: px, y: py } = wolf.mesh.position;
            const c = wolf.capsules;
            return Array.from({ length: CAPSULE_COUNT }, (_, i) => {
                const o = i * CAPSULE_STRIDE;
                return [c[o] * sx + px, c[o + 1] * sy + py, c[o + 2] * sx + px, c[o + 3] * sy + py];
            });
        };
        const pose = pack.everyWolf.map(() => null);
        const howled = pack.everyWolf.map(() => 0);
        const chorus = pack.wolves.map(() => []);
        let largest = 0;
        let step = 0;
        let k = 0;
        for (let frame = 0; frame < 180 * 30; frame++) {
            const t = frame / 30;
            while (k < calls.length && calls[k][0] <= t) {
                const [at, what] = calls[k++];
                pack[what](at);
            }
            pack.update(t);
            pack.everyWolf.forEach((wolf, w) => {
                const now = ends(wolf);
                if (now && pose[w]) {
                    now.forEach((end, i) => {
                        const was = pose[w][i];
                        largest = Math.max(largest, Math.hypot(end[0] - was[0], end[1] - was[1]),
                            Math.hypot(end[2] - was[2], end[3] - was[3]));
                    });
                }
                pose[w] = now;
                const level = wolf.visible ? wolf.howling * wolf.fade : 0;
                step = Math.max(step, Math.abs(level - howled[w]));
                howled[w] = level;
            });
            if (t >= 124 && t < 162) pack.wolves.forEach((wolf, w) => chorus[w].push([t, wolf.howling]));
        }
        // A galloping leg is the fastest thing in the night: under 9 units a frame at 30 a second.
        expect(largest).toBeLessThan(9);
        // A howl rises over 0.6 s: never more than 0.12 of it in a frame.
        expect(step).toBeLessThan(0.12);
        // Through the chorus a head may come down for the pack's breath, slowly; it never nods
        // down and straight back up (deeper than 0.15 within 1.2 s).
        for (const track of chorus) {
            for (let j = 1; j < track.length - 1; j++) {
                const [t, h] = track[j];
                if (!(h <= track[j - 1][1] && h < track[j + 1][1])) continue;
                const near = track.filter(([u]) => Math.abs(u - t) <= 0.6).map(([, v]) => v);
                const before = Math.max(...track.filter(([u]) => u <= t && t - u <= 0.6).map(([, v]) => v));
                const after = Math.max(...track.filter(([u]) => u >= t && u - t <= 0.6).map(([, v]) => v));
                expect(near.length).toBeGreaterThan(0);
                expect(Math.min(before, after) - h).toBeLessThan(0.15);
            }
        }
    });

    it('hands every band of moonlight, ripple and run-end snow over without a cut', () => {
        const director = new WolfhourNightDirector();
        const calls = [];
        for (let t = 1; t < 40; t += 0.45) calls.push([t, 'lock', { x: Math.sin(t) * 200, y: -150, hardDrop: (t * 7) % 3 < 1.4 }]);
        for (let t = 1.2; t < 40; t += 0.9) calls.push([t, 'clear', { lines: 1 + Math.floor(t % 4) }]);
        calls.push([12, 'backToBack'], [12.2, 'backToBack'], [20, 'over'], [21.5, 'begin'], [22, 'over'], [22.4, 'begin']);
        calls.sort((a, b) => a[0] - b[0]);
        const keys = ['sweepA', 'sweepB', 'glow', 'ripple', 'fall'];
        const read = (n) => [n.sweeps[0][1], n.sweeps[1][1], n.glow, n.ripple[3], n.fall];
        const worst = keys.map(() => 0);
        let before = null;
        let k = 0;
        // At 240 frames a second a cut keeps its size; a smooth change shrinks with the frame.
        for (let frame = 0; frame < 40 * 240; frame++) {
            const t = frame / 240;
            while (k < calls.length && calls[k][0] <= t) {
                const [at, what, arg] = calls[k++];
                director[what](at, arg);
            }
            const now = read(director.sample(t, 1));
            if (before) now.forEach((v, i) => { worst[i] = Math.max(worst[i], Math.abs(v - before[i])); });
            before = now;
        }
        const [sweepA, sweepB, glow, ripple, fall] = worst;
        expect(sweepA).toBeLessThan(0.06);
        expect(sweepB).toBeLessThan(0.06);
        expect(glow).toBeLessThan(0.08);
        expect(ripple).toBeLessThan(0.08);
        expect(fall).toBeLessThan(0.01);
    });

    it('swells the snow devil when fed and fades it out for the next, never stepping', () => {
        const snow = own(createWolfhourSnow({ quality: 'High' }));
        const whirls = [[10, 300, 1], [10.5, 300, 0.6], [12, -300, 1], [12.1, -300, 0.6], [17, 200, 1]];
        let k = 0;
        let before = 0;
        let worst = 0;
        for (let frame = 9 * 240; frame < 22 * 240; frame++) {
            const t = frame / 240;
            while (k < whirls.length && whirls[k][0] <= t) {
                const [at, x, s] = whirls[k++];
                snow.whirl(at, x, -340, s);
            }
            snow.update(t, {});
            const now = snow.devilStrength(t);
            worst = Math.max(worst, Math.abs(now - before));
            before = now;
        }
        // (At 240 frames a second; a devil cut off or stepped would move by most of its strength.)
        expect(worst).toBeLessThan(0.05);
        // The twist in the first devil's second half rose once it had faded (a moment later).
        expect(snow.devilLeft(12.3)).toBeGreaterThan(SNOW_DEVIL.life - 0.1);
    });

    it('never cuts a howl arc still in the air, even when a full chorus outruns a small tier', () => {
        const voices = own(createWolfhourVoices({ quality: 'Low' }));
        voices.setMoon(-300, 340);
        const chorus = Array.from({ length: 8 }, (_, i) => [-700 + i * 190, -180, -950, 1]);
        const born = voices.mesh.geometry.getAttribute('aVoice').array;
        const seen = new Float64Array(born.length / 4).fill(-1e3);
        let youngest = Infinity;
        for (let t = 0; t < 8; t += 1 / 30) {
            voices.update(t, chorus);
            for (let i = 0; i < seen.length; i++) {
                if (born[i * 4] !== seen[i]) {
                    if (seen[i] > -1e3) youngest = Math.min(youngest, t - seen[i]);
                    seen[i] = born[i * 4];
                }
            }
        }
        // Slots were reused (the tier is small for eight voices), each only once its arc had faded.
        expect(youngest).toBeLessThan(Infinity);
        expect(youngest).toBeGreaterThanOrEqual(VOICE.life * 0.85 - 1e-6);
    });

    it('eases an event\'s energy into the light over a few frames and follows its decay down', () => {
        const theme = new WolfhourTheme();
        theme.activeQualityLevel = 'High';
        theme.time = 5;
        theme.addEffectState({ mountainPulse: 1, nebulaDefinition: 0.8, cameraShake: 0.4 });
        // The store takes the energy at once (the shake reads it at once: a jolt).
        expect(theme.effectState.mountainPulse).toBe(1);
        const shown = [];
        for (let frame = 0; frame < 30; frame++) {
            theme.time += 1 / 30;
            theme.updateEffects(1 / 30);
            shown.push(theme.effectShown.mountainPulse);
            if (frame === 0) expect(theme.effectShown.cameraShake).toBe(theme.effectState.cameraShake);
        }
        // Up over several frames, never a step: the first frame shows under a third of it.
        expect(shown[0]).toBeLessThan(0.33);
        for (let i = 1; i < shown.length; i++) expect(Math.abs(shown[i] - shown[i - 1])).toBeLessThan(0.3);
        const peak = Math.max(...shown);
        expect(peak).toBeGreaterThan(0.45);
        // And down with the energy itself once it has caught it.
        expect(shown.at(-1)).toBeCloseTo(theme.effectState.mountainPulse, 6);
        expect(shown.at(-1)).toBeLessThan(peak);
    });
});

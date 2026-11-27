/**
 * The sea vent and the lake's events (earth-core-sea-vent.js, earth-core-lake-events.js): what
 * stands where the shaft opens onto the sea floor, and what the lake throws and the shaft drops.
 * A test can hold the geometry (the stacks are wound to be seen from outside and stand on the
 * lip; nothing of them is in the follow camera's frame when their presence starts to fade), the
 * handoff curves, and that every material builds for WebGPU (WGSL) and the WebGL2 fallback (GLSL)
 * on a device-less renderer. The look is capture-verified (ADR-0007).
 */
import {
    beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    SEA_VENT_BUBBLES_BY_TIER,
    SEA_VENT_CHIMNEYS,
    SEA_VENT_SPARKS_BY_TIER,
    buildSeaVentChimneys,
    buildSeaVentPlumes,
    createSeaVent,
    seaVentDarkness,
    seaVentPresence,
    updateSeaVent,
} from '../../src/rendering/odyssey/chapter-environments/earth-core-sea-vent.js';
import {
    LAKE_EVENT_GOBBETS_BY_TIER,
    createLakeEvents,
    rockFallOrigin,
    updateLakeEvents,
} from '../../src/rendering/odyssey/chapter-environments/earth-core-lake-events.js';
import { sampleEarthCoreClock } from '../../src/rendering/odyssey/chapter-environments/earth-core-clock.js';
import {
    SHAFT, planEarthCoreShaft, shaftRadiusAt,
} from '../../src/rendering/odyssey/chapter-environments/earth-core-shaft.js';
import { createEarthCoreEnvironment } from '../../src/rendering/odyssey/chapter-environments/earth-core.js';
import { STEAM_QUENCH_EXIT_HALF_WIDTH } from '../../src/rendering/odyssey/composition/odyssey-steam-quench.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const vista = { x: 0.677, z: 0.736 };
const len = Math.hypot(vista.x, vista.z);
vista.x /= len; vista.z /= len;
const right = { x: -vista.z, z: vista.x };
const plan = planEarthCoreShaft({
    axis: { x: -3.5, z: -0.6 }, lakeY: -10, vista, right,
});
const chapterUniforms = () => ({
    uTime: uniform(3),
    uCamRight: uniform(new THREE.Vector3(1, 0, 0)),
    uCamUp: uniform(new THREE.Vector3(0, 0, 1)),
});
const BOUNDARY = 0.0649;

function stubCanvasDocument() {
    const gradient = { addColorStop: vi.fn() };
    const context = {
        clearRect: vi.fn(),
        createRadialGradient: vi.fn(() => gradient),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
    };
    vi.stubGlobal('document', {
        createElement: vi.fn(() => ({ width: 0, height: 0, getContext: vi.fn(() => context) })),
    });
}

describe('the sea vent — its stacks', () => {
    let built;
    beforeAll(() => { built = buildSeaVentChimneys(plan); });

    it('stands them on the vent\'s lip, round the rim, clear of the rail\'s side of the frame', () => {
        const lipY = plan.lakeY + SHAFT.H_TOP;
        expect(built.mouths).toHaveLength(SEA_VENT_CHIMNEYS.length);
        SEA_VENT_CHIMNEYS.forEach((spec, i) => {
            // On the rim: outside the throat, within the lip's flare and a little past it.
            expect(spec.r).toBeGreaterThan(SHAFT.R_THROAT);
            expect(spec.r).toBeLessThan(SHAFT.R_LIP + 4);
            // Azimuth 0 is screen-down while climbing, where the rail and the orbs rise.
            expect(Math.abs(spec.azimuth)).toBeGreaterThan((45 * Math.PI) / 180);
            const mouth = built.mouths[i];
            expect(mouth.top.y).toBeCloseTo(lipY + spec.height, 3);
            // They lean in over the vent, never out past their own foot by much.
            const r = Math.hypot(mouth.top.x - plan.axis.x, mouth.top.z - plan.axis.z);
            expect(r).toBeLessThan(spec.r + 4);
            expect(r).toBeGreaterThan(SHAFT.R_THROAT - 6);
        });
    });

    it('winds them to be seen from outside', () => {
        // Each vertex's normal against the direction from its own ring's centre: the flanks face out.
        const { geometry } = built;
        const pos = geometry.getAttribute('position');
        const nrm = geometry.getAttribute('normal');
        const vent = geometry.getAttribute('aVent');
        let outward = 0;
        let total = 0;
        const sides = 18;
        let v = 0;
        while (v + sides <= pos.count) {
            // The mouth's centre vertex (aVent.w = 1) ends a stack: skip it.
            if (vent.getW(v) > 0.5) { v += 1; continue; }
            let cx = 0; let cz = 0;
            for (let i = 0; i < sides; i += 1) { cx += pos.getX(v + i); cz += pos.getZ(v + i); }
            cx /= sides; cz /= sides;
            for (let i = 0; i < sides; i += 3) {
                const d = (nrm.getX(v + i) * (pos.getX(v + i) - cx)) + (nrm.getZ(v + i) * (pos.getZ(v + i) - cz));
                if (d > 0) outward += 1;
                total += 1;
            }
            v += sides;
        }
        expect(total).toBeGreaterThan(500);
        expect(outward / total).toBeGreaterThan(0.95);
    });

    it('is a few thousand triangles, and the plumes a few thousand more', () => {
        const stackTris = built.geometry.index.count / 3;
        expect(stackTris).toBeGreaterThan(4000);
        expect(stackTris).toBeLessThan(30000);
        const plumes = buildSeaVentPlumes(built.mouths);
        expect(plumes.index.count / 3).toBeLessThan(4000);
        expect(plumes.getAttribute('aPlume').count).toBe(plumes.getAttribute('position').count);
        const finite = (attr) => Array.from(attr.array).every(Number.isFinite);
        expect(finite(built.geometry.getAttribute('position'))).toBe(true);
        expect(finite(built.geometry.getAttribute('normal'))).toBe(true);
        expect(finite(plumes.getAttribute('position'))).toBe(true);
    });
});

describe('the sea vent — its handoff', () => {
    it('is not there from the low shaft, is whole through the crossing, and is gone before the chapter is', () => {
        expect(seaVentPresence(0.0, BOUNDARY)).toBe(0);
        expect(seaVentPresence(0.039, BOUNDARY)).toBe(0);
        expect(seaVentPresence(0.050, BOUNDARY)).toBe(1);
        expect(seaVentPresence(BOUNDARY, BOUNDARY)).toBe(1);
        expect(seaVentPresence(BOUNDARY + 0.014, BOUNDARY)).toBe(1);
        // The chapter group leaves at boundary + the ecotone's half-width.
        expect(seaVentPresence(BOUNDARY + STEAM_QUENCH_EXIT_HALF_WIDTH - 0.0005, BOUNDARY)).toBe(0);
        // Continuous: no step larger than the curve's own slope allows.
        let prev = seaVentPresence(0, BOUNDARY);
        for (let p = 0; p <= 0.1; p += 0.0001) {
            const v = seaVentPresence(p, BOUNDARY);
            expect(Math.abs(v - prev)).toBeLessThan(0.04);
            prev = v;
        }
        expect(seaVentPresence(NaN, BOUNDARY)).toBe(1);
    });

    it('lets the sparks of life show only while the water is dark', () => {
        expect(seaVentDarkness(BOUNDARY, BOUNDARY)).toBe(1);
        expect(seaVentDarkness(BOUNDARY + 0.019, BOUNDARY)).toBe(0);
        let prev = 1;
        for (let p = BOUNDARY; p <= BOUNDARY + 0.02; p += 0.0005) {
            const v = seaVentDarkness(p, BOUNDARY);
            expect(v).toBeLessThanOrEqual(prev + 1e-9);
            prev = v;
        }
    });

    it('has left the follow camera\'s frame before its presence starts to fade', () => {
        // The real chapter, the real camera: every stack's mouth is out of the up-looking frame by
        // the progress at which seaVentPresence leaves 1 — a stack still in frame then would
        // dissolve in plain view against the ocean's blue (capture p 0.081 with taller stacks).
        stubCanvasDocument();
        const group = createEarthCoreEnvironment({ qualityTier: 'High', clockOffset: 0 });
        const rig = createOdysseyCameraRig();
        const boundary = rig.cp[1];
        let fadeStart = boundary;
        while (seaVentPresence(fadeStart + 0.0002, boundary) >= 1) fadeStart += 0.0002;
        const { mouths } = group.userData.seaVent.userData.seaVent;
        const world = new THREE.Vector3();
        [fadeStart, fadeStart + 0.002, fadeStart + 0.005].forEach((p) => {
            const cam = rig.poseAt(p);
            mouths.forEach((m, i) => {
                world.copy(m.top).add(group.position);
                expect(rig.inFrame(cam, world, 1), `mouth ${i} at p ${p.toFixed(4)}`).toBe(false);
            });
        });
        // ...and from orb 5's station on the rail, inside the steam, most of them ring the sea's
        // eye. (The eye passes it on the glide to orb 6: the orb's own close-up parks before the
        // steam, odyssey-chapter-arrival.js.)
        const cam5 = rig.poseAt(rig.layout.levelPositionsById[5]);
        const seen = mouths.filter((m) => rig.inFrame(cam5, world.copy(m.top).add(group.position), 1)).length;
        expect(seen).toBeGreaterThanOrEqual(4);
    });
});

describe('the sea vent — its materials', () => {
    it('is three draws the chapter fades itself, sized by tier', () => {
        const high = createSeaVent(chapterUniforms(), plan, { qualityTier: 'High' });
        const low = createSeaVent(chapterUniforms(), plan, { qualityTier: 'Low' });
        expect(high.userData.odysseyFadeExempt).toBe(true);
        expect(high.children.map((c) => c.name)).toEqual(['sea-vent-chimneys', 'sea-vent-plumes', 'sea-vent-bubbles']);
        const count = (g) => g.children[2].geometry.instanceCount;
        expect(count(high)).toBe(SEA_VENT_BUBBLES_BY_TIER.high + SEA_VENT_SPARKS_BY_TIER.high);
        expect(count(low)).toBe(SEA_VENT_BUBBLES_BY_TIER.low + SEA_VENT_SPARKS_BY_TIER.low);
        expect(count(low)).toBeLessThan(count(high) / 2);
        // The stacks are not there at all while their presence is zero (no depth written).
        expect(high.children[0].material.alphaTest).toBeGreaterThan(0);
        high.children.forEach((c) => expect(c.material.fog).toBe(false));
    });

    it('builds for WebGPU and WebGL2', () => {
        const vent = createSeaVent(chapterUniforms(), plan, { qualityTier: 'High' });
        vent.children.forEach((mesh) => {
            [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]].forEach(([label, Builder]) => {
                const out = build(Builder, mesh);
                expect(out.thrown, `${mesh.name} ${label} ${out.thrown?.stack ?? ''}`).toBeUndefined();
                expect(out.heard, `${mesh.name} ${label}`).toEqual([]);
                expect(`${out.vertex}\n${out.fragment}`, `${mesh.name} ${label}`)
                    .not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                if (label === 'WGSL') expect(unassignedReads(out.fragment), mesh.name).toEqual([]);
            });
        });
    });

    it('is driven by progress and the clock, and banks the gas so a pulse never teleports a bubble', () => {
        const vent = createSeaVent(chapterUniforms(), plan, {});
        const u = vent.userData.seaVent.uniforms;
        const camera = new THREE.PerspectiveCamera();
        camera.lookAt(0, 1, 0);
        camera.updateMatrixWorld(true);
        updateSeaVent(vent, {
            delta: 0.016, camera, progress: 0.056, boundary: BOUNDARY, veil: 1, eyeRadius: 0.27, pulse: 0,
        });
        const calm = u.uGasPhase.value;
        expect(u.uSea.value).toBe(0);
        expect(u.uPresence.value).toBe(1);
        // Looking straight up, the camera's up is horizontal: the quads still have two axes.
        expect(u.uCamRight.value.length()).toBeCloseTo(1, 5);
        expect(u.uCamUp.value.length()).toBeCloseTo(1, 5);
        expect(Math.abs(u.uCamUp.value.y)).toBeLessThan(0.01);
        updateSeaVent(vent, {
            delta: 0.016, camera, progress: 0.056, boundary: BOUNDARY, veil: 1, eyeRadius: 0.27, pulse: 1,
        });
        const pulsed = u.uGasPhase.value - calm;
        expect(pulsed).toBeGreaterThan(0.016);
        expect(pulsed).toBeLessThan(0.016 * 2.5);
        // In the sea: the air between is water, the stacks take the sea's light.
        updateSeaVent(vent, {
            delta: 0.016, camera, progress: 0.07, boundary: BOUNDARY, veil: 0.3, eyeRadius: 1.3, pulse: 0,
        });
        expect(u.uSea.value).toBe(1);
        expect(u.uAirColour.value.b).toBeGreaterThan(u.uAirColour.value.r);
        // Reduced motion: the gas rises slowly and the pulse is held.
        const before = u.uGasPhase.value;
        updateSeaVent(vent, {
            delta: 0.016, camera, progress: 0.07, boundary: BOUNDARY, pulse: 1, reducedMotion: true,
        });
        expect(u.uGasPhase.value - before).toBeLessThan(0.016);
        expect(u.uVentPulse.value).toBe(0);
    });
});

describe('the lake\'s events — what it throws and the shaft drops', () => {
    it('builds for WebGPU and WebGL2, one draw sized by tier', () => {
        const mesh = createLakeEvents(chapterUniforms(), plan, { qualityTier: 'High' });
        const low = createLakeEvents(chapterUniforms(), plan, { qualityTier: 'Low' });
        expect(mesh.geometry.instanceCount - low.geometry.instanceCount)
            .toBe(LAKE_EVENT_GOBBETS_BY_TIER.high - LAKE_EVENT_GOBBETS_BY_TIER.low);
        expect(mesh.userData.odysseyFadeExempt).toBe(true);
        [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]].forEach(([label, Builder]) => {
            const out = build(Builder, mesh);
            expect(out.thrown, `${label} ${out.thrown?.stack ?? ''}`).toBeUndefined();
            expect(out.heard, label).toEqual([]);
            expect(`${out.vertex}\n${out.fragment}`, label).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
        });
    });

    it('starts a rock fall on the wall, high over the watcher, never above the throat', () => {
        [0, 18, 50, 83, 120].forEach((eye) => {
            [0, 0.5, 1].forEach((h01) => {
                [Math.PI * 0.5, Math.PI * 0.8, -Math.PI * 0.6, Math.PI].forEach((azimuth) => {
                    const { origin, inward, h } = rockFallOrigin(plan, azimuth, h01, eye);
                    expect(h).toBeLessThanOrEqual(132);
                    expect(h).toBeGreaterThanOrEqual(70);
                    // As far over the eye as the shaft allows.
                    if (eye + 80 <= 132) expect(h - eye).toBeGreaterThanOrEqual(80);
                    const r = Math.hypot(origin.x - plan.axis.x, origin.z - plan.axis.z);
                    expect(r).toBeCloseTo(shaftRadiusAt(h) - 3.5, 4);
                    expect(origin.y).toBeCloseTo(plan.lakeY + h, 6);
                    // Pushed toward the axis.
                    const toAxis = ((plan.axis.x - origin.x) * inward.x) + ((plan.axis.z - origin.z) * inward.z);
                    expect(toAxis).toBeGreaterThan(0);
                    expect(inward.length()).toBeCloseTo(1, 5);
                });
            });
        });
    });

    it('moves the fountain only between plays, keeps a fall\'s ledge, and holds still for reduced motion', () => {
        const mesh = createLakeEvents(chapterUniforms(), plan, {});
        const u = mesh.userData.lakeEvents.uniforms;
        let lastSlot = null;
        let lastX = null;
        let played = 0;
        let fell = 0;
        for (let t = 0; t < 600; t += 1 / 30) {
            const clock = sampleEarthCoreClock(t, {});
            updateLakeEvents(mesh, { clock, eyeHeight: 30, presence: 1 });
            if (u.uFountain.value.w > 0.05) {
                played += 1;
                if (lastSlot === clock.fountain.slot) expect(u.uFountain.value.x).toBe(lastX);
                lastSlot = clock.fountain.slot;
                lastX = u.uFountain.value.x;
                expect(u.uFountain.value.x).toBe(clock.fountain.x);
                expect(u.uFountain.value.y).toBe(plan.lakeY);
            }
            if (u.uRock.value.w > 0.05) {
                fell += 1;
                expect(u.uRock.value.y).toBeGreaterThan(plan.lakeY + 69);
                expect(u.uRockB.value.z).toBeGreaterThan(0);
            }
        }
        expect(played).toBeGreaterThan(100);
        expect(fell).toBeGreaterThan(100);
        // Reduced motion, or the cavern out of frame: nothing thrown, nothing falling.
        for (let t = 600; t < 700; t += 0.5) {
            updateLakeEvents(mesh, { clock: sampleEarthCoreClock(t, {}), reducedMotion: true });
            expect(u.uFountain.value.w).toBe(0);
            expect(u.uRock.value.w).toBe(0);
            updateLakeEvents(mesh, { clock: sampleEarthCoreClock(t, {}), presence: 0 });
            expect(u.uFountain.value.w).toBe(0);
        }
    });
});

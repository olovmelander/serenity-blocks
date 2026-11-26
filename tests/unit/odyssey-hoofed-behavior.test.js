import {
    beforeAll, describe, expect, it,
} from 'vitest';
import { readGlb } from '../../scripts/fox/glb-read.mjs';
import {
    ODYSSEY_DEER, buildHerd, createDeerRig, planFootfalls as planDeer, poseDeer,
} from '../../src/rendering/odyssey/composition/odyssey-deer-herd.js';
import {
    ODYSSEY_HORSES, buildBand, createHorseRig, planFootfalls as planHorses, poseHorse,
} from '../../src/rendering/odyssey/composition/odyssey-horse-band.js';
import { ODYSSEY_IBEX, createIbexGround } from '../../src/rendering/odyssey/composition/odyssey-ibex-herd.js';
import { ODYSSEY_TARN_DEER } from '../../src/rendering/odyssey/composition/odyssey-pond-life-motion.js';
import { odysseyTarnDistance, odysseyWorldHeight } from '../../src/rendering/odyssey/world/odyssey-world-height.js';

function modelExtras(path) {
    const { json } = readGlb(new URL(`../../src/rendering/odyssey/assets/${path}.glb`, import.meta.url));
    return json.scenes[json.scene].extras;
}

const herds = {};
let foalMuzzle;
let ibexMuzzle;
beforeAll(() => {
    const deer = createDeerRig(modelExtras('chapter-03/deer/red-deer').skeleton);
    const ibexModel = modelExtras('chapter-04/ibex/alpine-ibex');
    const ibex = createDeerRig(ibexModel.skeleton);
    ibexMuzzle = ibexModel.landmarks.muzzle;
    for (const [name, config, rig] of [
        ['glade deer', ODYSSEY_DEER, deer], ['tarn deer', ODYSSEY_TARN_DEER, deer], ['ibex', ODYSSEY_IBEX, ibex],
    ]) {
        const herd = planDeer(buildHerd(config), rig, config);
        herds[name] = herd.map((animal) => ({
            animal, rig, pose: poseDeer, config,
        }));
    }
    const model = modelExtras('chapter-03/horses/wild-horses');
    const { horse, foal } = model.skeletons;
    foalMuzzle = model.landmarks.foal.muzzle;
    const rigs = { horse: createHorseRig(horse), foal: createHorseRig(foal) };
    const band = planHorses(buildBand(), rigs);
    herds.horses = band.map((animal) => ({
        animal, rig: rigs[animal.member.model], pose: poseHorse, config: ODYSSEY_HORSES,
    }));
});

// Read local joint angles so walking, grazing posture and the ground slope cannot masquerade as a chew or ear flick.
function faceAt({
    animal, rig, pose, config,
}, time) {
    const { state } = pose(rig, animal, time, odysseyWorldHeight, null, 0, config);
    return {
        feeding: state.head > 0.995 && state.speed < 0.001,
        jaw: rig.local[rig.index.jaw][0],
        left: rig.local[rig.index.earL][2],
        right: rig.local[rig.index.earR][2],
    };
}

describe.each(['glade deer', 'tarn deer', 'ibex', 'horses'])('%s feeding and listening', (name) => {
    it('takes bites at individual times when two herd members have their heads down together', () => {
        const [first, second] = herds[name];
        let difference = 0;
        let frames = 0;
        let restingFrames = 0;
        let longestPause = 0;
        for (let frame = 0; frame < 30 * 60; frame += 1) {
            const a = faceAt(first, frame / 30);
            const b = faceAt(second, frame / 30);
            restingFrames = a.feeding && Math.abs(a.jaw) < 0.005 ? restingFrames + 1 : 0;
            longestPause = Math.max(longestPause, restingFrames);
            if (a.feeding && b.feeding) {
                difference += Math.abs(a.jaw - b.jaw);
                frames += 1;
            }
        }
        expect(frames).toBeGreaterThan(30);
        expect(difference / frames).toBeGreaterThan(0.004);
        expect(longestPause / 30, 'a pause between bites, seconds').toBeGreaterThan(0.5);
    });

    it('can flick either ear alone and reproduces its pose when the clock seeks backwards', () => {
        const [first] = herds[name];
        const original = faceAt(first, 5.25);
        let left = -Infinity;
        let right = -Infinity;
        for (let frame = 0; frame < 20 * 60; frame += 1) {
            const face = faceAt(first, frame / 20);
            // The resting roll mirrors between ears. Their sum measures how far one has moved on its own.
            const asymmetry = face.left + face.right;
            left = Math.max(left, asymmetry);
            right = Math.max(right, -asymmetry);
        }
        expect(left).toBeGreaterThan(0.12);
        expect(right).toBeGreaterThan(0.12);
        expect(faceAt(first, 5.25)).toEqual(original);
    });
});

it('drinks with a quieter jaw at the waterline and crops on the meadow above it', () => {
    const [hind] = herds['tarn deer'];
    let shore = 0;
    let meadow = 0;
    for (const segment of hind.animal.segments.filter((s) => s.kind === 'graze')) {
        // Look where the muzzle reaches, ahead of the chest, while the hind stands at this spot.
        const reach = hind.animal.k * 1.3;
        const margin = odysseyTarnDistance(
            segment.x0 + Math.sin(segment.h0) * reach,
            segment.z0 + Math.cos(segment.h0) * reach,
        );
        for (let age = 2; age < segment.dur - 0.5; age += 1 / 30) {
            const face = faceAt(hind, segment.t0 + age);
            if (margin < -0.5) shore = Math.max(shore, face.jaw);
            if (margin > 10) meadow = Math.max(meadow, face.jaw);
        }
    }
    expect(shore, 'a swallow at the shore').toBeGreaterThan(0.006);
    expect(meadow, 'a bite on grass').toBeGreaterThan(0.05);
    expect(shore).toBeLessThan(meadow * 0.65);
});

function posedPoint({ animal, rig }, bone, point) {
    const joint = rig.index[bone];
    const offset = point.map((v, i) => (v - rig.skeleton[joint].head[i]) * animal.k);
    const r = rig.R[joint];
    return rig.J[joint].map((v, i) => v + r[3 * i] * offset[0] + r[3 * i + 1] * offset[1] + r[3 * i + 2] * offset[2]);
}

it('brings every grazing ibex muzzle to the local shelf and perch tops without snapping the neck', () => {
    const ground = createIbexGround(odysseyWorldHeight);
    expect(ODYSSEY_IBEX.graze.muzzle).toEqual(ibexMuzzle);
    for (const ibex of herds.ibex) {
        const { animal, rig } = ibex;
        const clearances = [];
        let maxPitchSpeed = 0;
        for (const segment of animal.segments.filter((s) => s.kind === 'graze')) {
            let lastPitch;
            // Keep the full settled bout, including the pauses and lift after a pluck.
            for (let age = 1.8; age < segment.dur; age += 1 / 30) {
                const time = segment.t0 + age;
                poseDeer(rig, animal, time, ground, null, 0, ODYSSEY_IBEX);
                const [x, y, z] = posedPoint(ibex, 'head', ibexMuzzle);
                clearances.push((y - ground(x, z)) / animal.k);
                const pitch = ['chest', 'neck0', 'neck1', 'neck2', 'head'].map((bone) => rig.local[rig.index[bone]][0]);
                if (lastPitch) {
                    for (let i = 0; i < pitch.length; i += 1) {
                        maxPitchSpeed = Math.max(maxPitchSpeed, Math.abs(pitch[i] - lastPitch[i]) * 30);
                    }
                }
                lastPitch = pitch;
            }
        }
        clearances.sort((a, b) => a - b);
        const label = `${animal.member.name} #${animal.member.seed}`;
        expect(clearances.length, label).toBeGreaterThan(100);
        expect(clearances[0], `${label} deepest dip`).toBeGreaterThan(-0.04);
        expect(clearances[Math.floor(clearances.length / 2)], `${label} median reach`).toBeLessThan(0.045);
        expect(clearances[Math.floor(clearances.length * 0.99)], `${label} lifted muzzle`).toBeLessThan(0.08);
        expect(maxPitchSpeed, `${label} neck angular speed (rad/s)`).toBeLessThan(1.5);
    }
});

it('places each suckling muzzle beneath the flank of the posed mare on the actual slope', () => {
    for (const foal of herds.horses.filter((entry) => entry.animal.member.model === 'foal')) {
        const mare = herds.horses[foal.animal.member.mother];
        let worst = 0;
        let frames = 0;
        for (const segment of foal.animal.segments.filter((s) => s.kind === 'nurse')) {
            // The approach and release take 1.5 s each. Measure contact while the foal is latched.
            for (let age = 1.5; age <= segment.dur - 1.5; age += 1 / 30) {
                const time = segment.t0 + age;
                faceAt(foal, time);
                const muzzle = posedPoint(foal, 'head', foalMuzzle);
                faceAt(mare, time);
                // The model's lower flank just ahead of the hind leg, in its own rest frame.
                const gaps = [-1, 1].map((side) => {
                    const flank = posedPoint(mare, 'pelvis', [0.17 * side, 0.78, -0.45]);
                    return Math.hypot(...muzzle.map((v, i) => v - flank[i])) / mare.animal.k;
                });
                worst = Math.max(worst, Math.min(...gaps));
                frames += 1;
            }
        }
        expect(frames).toBeGreaterThan(10);
        expect(worst, 'muzzle to lower flank, life-size metres').toBeLessThan(0.16);
    }
});

it('keeps the mouth still during a doze and lets both foals suckle at their mothers', () => {
    const peaks = { doze: 0, nurse: 0, graze: 0 };
    let restFrames = 0;
    for (const horse of herds.horses) {
        let suckling = 0;
        for (const segment of horse.animal.segments.filter((s) => Object.hasOwn(peaks, s.kind))) {
            for (let age = 1.8; age < segment.dur - 1.8; age += 1 / 20) {
                const { jaw } = faceAt(horse, segment.t0 + age);
                peaks[segment.kind] = Math.max(peaks[segment.kind], Math.abs(jaw));
                if (segment.kind === 'doze') restFrames += 1;
                if (segment.kind === 'nurse') suckling = Math.max(suckling, jaw);
            }
        }
        if (horse.animal.member.model === 'foal') expect(suckling).toBeGreaterThan(0.006);
    }
    expect(restFrames).toBeGreaterThan(30);
    expect(peaks.doze).toBeLessThan(0.005);
    expect(peaks.graze).toBeGreaterThan(0.05);
    expect(peaks.nurse).toBeLessThan(peaks.graze * 0.6);
});

/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE LATTICE — the fold's second place (orb 51: Chiral Gold).
 *
 * Beams of gold in an endless lattice that winds through itself: two lattices, each wound about
 * the way ahead, one to the right and one to the left, the second half a cell off so it runs
 * through the first's open squares. Lights sit where the first's beams cross.
 *
 * Walked: at each step the distance to the nearest beam of each. Light is summed along the ray by
 * step length (so the picture does not depend on how the steps fall), its width an angle.
 */
import {
    Break, If, Loop, clamp, dot, exp, float, floor, int, length, max, min, mix, sin, smoothstep, vec3,
} from 'three/tsl';
import {
    frameRows, gauss, glowAt, rot2, sq, turn,
} from './fold-tools.tsl.js';

export const LATTICE = Object.freeze({
    frame: [21, -13, 9],
    cell: 3.4,
    beam: 0.03,
    node: 0.12,
    /** The winding: radians per unit of depth (the second lattice winds the other way). */
    twist: 0.055,
    reach: 30,
    fog: 0.085,
    glowK: 90000,
    /** Where the eye rides in the first lattice's cell (off its beams). */
    eye: [1.7, 1.25],
    /** A beam nearer the eye than `nearTo` fades, and is gone by `nearFrom`: the lattice winds
     * slowly, so its beams do sweep through the eye's own line, and one in the lens is a flash. */
    nearFrom: 1.0,
    nearTo: 4.0,
    /** The fewest steps the walk is given: passing one beam takes three or four, so at the Low
     * tier's fourteen the lattice was four beams and the dark. */
    minSteps: 20,
});

const ROWS = frameRows(LATTICE.frame);

function inCell(p, cell) {
    const q = p.div(cell);
    return q.sub(floor(q.add(0.5))).mul(cell);
}

export function placeLattice({
    rd, tm, zEye, mood, event, eventAge, steps, jitter,
}) {
    const V = LATTICE;
    const r = turn(rd, ROWS).toVar();
    const acc = vec3(0).toVar();
    const t = float(0.5).add(jitter.mul(0.7)).toVar();
    const gold = mix(vec3(1.0, 0.56, 0.13), vec3(1.0, 0.40, 0.08), mood.x).toVar();
    const pale = mix(vec3(1.0, 0.86, 0.58), vec3(0.98, 0.74, 0.80), mood.y).toVar();
    // The happening: a bright wave of light running out along the beams.
    const waveAt = eventAge.mul(4.6).sub(6.0).toVar();
    Loop({
        start: int(0), end: int(Math.max(V.minSteps, steps)), type: 'int', condition: '<', name: 'latStep',
    }, () => {
        const p = vec3(r.x.mul(t).add(V.eye[0]), r.y.mul(t).add(V.eye[1]), r.z.mul(t).add(zEye)).toVar();
        const wind = p.z.sub(zEye).mul(V.twist).add(tm.mul(0.011)).toVar();
        const a = rot2(p.xy, wind);
        const qa = inCell(vec3(a.x, a.y, p.z), V.cell).toVar();
        const dBeamA = min(min(length(qa.yz), length(qa.xz)), length(qa.xy)).sub(V.beam).toVar();
        const dNode = length(qa).sub(V.node).toVar();
        const b = rot2(p.xy, wind.mul(-0.8).add(0.6));
        const qb = inCell(vec3(b.x, b.y, p.z).add(V.cell / 2), V.cell).toVar();
        const dBeamB = min(min(length(qb.yz), length(qb.xz)), length(qb.xy)).sub(V.beam * 0.55).toVar();
        const d = min(min(dBeamA, dNode), dBeamB).toVar();
        const stepLen = max(d.mul(0.62), t.mul(0.012).add(0.06)).toVar();
        const fog = exp(t.mul(-V.fog));
        // Light runs along the beams in slow pulses.
        const pulse = sin(length(p.xy).mul(0.9).add(p.z.mul(0.55)).sub(tm.mul(0.5))).mul(0.5).add(0.5);
        const surge = gauss(t.sub(waveAt).div(2.6)).mul(event);
        const gain = fog.mul(stepLen).mul(pulse.mul(0.55).add(0.45).add(surge.mul(1.6)))
            .mul(smoothstep(V.nearFrom, V.nearTo, t));
        acc.addAssign(gold.mul(glowAt(dBeamA, t, V.glowK)).mul(gain).mul(1.5));
        acc.addAssign(pale.mul(glowAt(dBeamB, t, V.glowK)).mul(gain).mul(0.8));
        acc.addAssign(vec3(1.0, 0.93, 0.80).mul(glowAt(dNode, t, V.glowK * 0.5)).mul(gain).mul(2.2));
        t.addAssign(stepLen);
        If(t.greaterThan(V.reach), () => {
            Break();
        });
    });
    // The air it stands in: umber dark, a warm light low on one side, a cool depth on the other.
    const warm = clamp(dot(r, vec3(-0.52, -0.38, 0.76)), 0.0, 1.0);
    const air = vec3(0.006, 0.003, 0.002)
        .add(vec3(0.11, 0.030, 0.006).mul(sq(sq(warm))))
        .add(vec3(0.010, 0.004, 0.016).mul(smoothstep(-0.2, 0.9, r.y)));
    return acc.add(air);
}

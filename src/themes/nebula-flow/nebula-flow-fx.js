/**
 * Nebula Flow — the gameplay's light drawn as sprites over the nursery.
 *
 *   jets     every birth fires a pair of jets along one axis (a young star's outflow): thin,
 *            white-hot near the star, in the piece's colour further out, beaded with knots that
 *            run outward, a bow shock at each tip. A clear that frees the star fires them again,
 *            longer. The great star's jets cross the frame.
 *   flights  a lock's spark leaves the card's edge at the piece's height and curves into the
 *            pillar where its star will be kindled.
 *   blades   a cleared row leaves the card as a blade of light out of each side, at the row's
 *            own height, running to the edge of the frame.
 *
 * All of it reads closed-form state (the births table, the blades table) against the clock, so
 * a seek redraws any moment.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    cos,
    exp,
    float,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    BIRTH_ROWS, BIRTH_SLOTS, JET_LIFE, JET_RUN, KIND_AMBIENT, KIND_DROP, KIND_GREAT,
} from './nebula-flow-core.js';
import {
    nfClip, nfGauss, nfLightMaterial, nfPart, nfQuadGeometry,
} from './nebula-flow-tsl.js';

/** Twin of jetReach() in core. */
const jetReachNode = (age) => float(1).sub(exp(max(age, 0).div(JET_RUN * 0.45).negate()))
    .mul(age.greaterThan(0).select(1, 0));
/** Twin of jetLight() in core. */
const jetLightNode = (age) => smoothstep(0, 0.08, age).mul(float(1).sub(smoothstep(JET_LIFE * 0.35, JET_LIFE, age)))
    .mul(age.greaterThan(0).and(age.lessThan(JET_LIFE)).select(1, 0));

const clip = nfClip;

/**
 * A jet's star, read from its birth slot. Call it inside a `Fn`: the values every branch below
 * selects on are vars assigned at the root of the stage. Left as shared expressions they were
 * built first inside a branch, and their WGSL var was assigned there alone and read zero
 * everywhere else (an ambient star's ageFire did, and its jets never drew).
 * nebula-flow-shaders.test.js checks every stage for a var read where it may not be assigned.
 */
function jetStar(u, aJet) {
    const base = int(aJet.x.add(0.5)).mul(BIRTH_ROWS);
    const A = u.births.element(base);
    const C = u.births.element(base.add(1));
    const E = u.births.element(base.add(2));
    const kind = C.w.toVar();
    const ageFire = u.time.sub(A.z).toVar();
    const ageFree = E.y.greaterThanEqual(0).select(ageFire.sub(E.y), float(-1)).toVar();
    const isGreat = kind.greaterThan(KIND_GREAT - 0.5).and(kind.lessThan(KIND_GREAT + 0.5)).toVar();
    const isAmbient = kind.greaterThan(KIND_AMBIENT - 0.5).toVar();
    const isDrop = kind.greaterThan(KIND_DROP - 0.5).and(kind.lessThan(KIND_DROP + 0.5)).toVar();
    const reachBase = isGreat.select(1.35, isDrop.select(0.4, isAmbient.select(0.17, 0.3))).mul(E.z);
    const run = max(jetReachNode(ageFire), jetReachNode(ageFree).mul(1.2));
    // an ambient star's jets never die; they breathe
    const breath = sin(u.time.mul(0.35).add(E.w.mul(30.0))).mul(0.25).add(0.45);
    const lightNow = isAmbient.select(
        breath,
        jetLightNode(ageFire).add(jetLightNode(ageFree).mul(1.5)),
    ).mul(A.w.greaterThan(0.001).select(1, 0)).mul(ageFire.greaterThan(0).select(1, 0)).toVar();
    const len = reachBase.mul(isAmbient.select(1.0, run)).mul(lightNow.greaterThan(0.002).select(1, 0)).toVar();
    const bow = float(0.018).mul(E.z).mul(isGreat.select(3.0, 1.0)).toVar();
    // the quad stands well clear of the shock and its glow, which are windowed to nothing at its
    // edges (a great star's shock is bright enough to show a cut-off edge otherwise)
    const reach = bow.mul(2.6);
    const dir = vec2(cos(E.x), sin(E.x)).mul(aJet.y);
    return {
        A, C, E, ageFire, isGreat, isAmbient, lightNow, len, bow, dir, halfW: reach, tip: reach,
    };
}

/** The jets: two per birth slot (one each way along its axis). */
export function createJets(u) {
    const count = BIRTH_SLOTS * 2;
    const jet = new Float32Array(count * 2);
    for (let i = 0; i < count; i += 1) {
        jet[i * 2] = Math.floor(i / 2);
        jet[i * 2 + 1] = i % 2 === 0 ? 1 : -1;
    }
    const geometry = nfQuadGeometry(count, { aJet: { array: jet, size: 2 } });
    const material = nfLightMaterial();
    const aJet = attribute('aJet', 'vec2');
    const along = positionGeometry.y.add(1).mul(0.5);
    material.vertexNode = Fn(() => {
        const {
            A, dir, len, lightNow, bow,
        } = jetStar(u, aJet);
        const side = vec2(dir.y.negate(), dir.x);
        // a dark jet's quad collapses (a held star's jets end long before the star does)
        const reach = bow.mul(2.6).mul(lightNow.greaterThan(0.002).select(1, 0));
        const tip = reach;
        const halfW = reach;
        // in the dust's frame: the nursery pass shows the dust at its place − cam
        const root = A.xy.sub(u.cam);
        return clip(u, root.add(dir.mul(along.mul(len.add(tip)))).add(side.mul(positionGeometry.x.mul(halfW))));
    })();
    material.colorNode = vec4(0, 0, 0, 1);
    material.outputNode = Fn(() => {
        const {
            C, E, ageFire, isGreat, isAmbient, lightNow, len, bow, halfW, tip,
        } = jetStar(u, aJet);
        const s = along.mul(len.add(tip));
        const frac = s.div(max(len, 1e-4));
        // the jet precesses: a slow wiggle that grows along it
        const wiggle = sin(s.mul(float(26.0).div(E.z)).add(E.w.mul(40.0)).sub(u.time.mul(0.9)))
            .mul(0.006).mul(E.z).mul(clamp(frac, 0, 1));
        const x = positionGeometry.x.mul(halfW).sub(wiggle);
        // the beam is a hair near the star and frays toward the tip
        const w = mix(0.0016, 0.0055, clamp(frac, 0, 1)).mul(E.z).mul(isGreat.select(2.5, 1.0));
        const fall = pow(clamp(float(1).sub(frac), 0, 1), 0.6);
        const beam = nfGauss(x.div(w)).mul(step1(len.sub(s))).mul(fall);
        const haze = nfGauss(x.div(w.mul(4.0))).mul(step1(len.sub(s))).mul(fall).mul(0.12);
        const age = isAmbient.select(u.time, max(ageFire, 0));
        // knots: shocks that run outward along the beam, unevenly spaced (the outflow comes in
        // fits)
        // (spaced so that even a short jet carries several: at a third of this, a lock's jet was
        // shorter than one spacing and drew as a lit rod)
        const knotPhase = s.mul(isAmbient.select(64.0, 46.0).div(E.z)).sub(age.mul(5.0))
            .add(sin(s.mul(isAmbient.select(23.0, 16.0).div(E.z)).add(E.w.mul(17.0))).mul(1.4));
        const knot = pow(clamp(cos(knotPhase).mul(0.5).add(0.5), 0, 1), 10.0);
        // the bow shock: a small cap at the tip, opening back toward the star (blunt, and dim off
        // the axis, so its arms never reach back round the star like a ring); it forms once the
        // jet has run out a few widths
        const tx = s.sub(len);
        const arc = tx.add(x.mul(x).div(bow.mul(1.6)));
        const shock = nfGauss(arc.div(0.0045)).mul(nfGauss(x.div(bow.mul(0.75))))
            .mul(smoothstep(bow.mul(3.0), bow.mul(8.0), len));
        const glow = nfGauss(length(vec2(tx, x)).div(bow.mul(1.2))).mul(0.25);
        const edge = float(1).sub(smoothstep(0.55, 1.0, abs(positionGeometry.x)))
            .mul(float(1).sub(smoothstep(0.45, 1.0, tx.div(tip))));
        // an outflow is a chain of knots in a faint beam, not a lit rod capped at both ends; an
        // ambient star's is fainter still
        const between = isAmbient.select(0.04, 0.2);
        const core = beam.mul(knot.mul(2.2).add(between)).add(haze.mul(isAmbient.select(0.55, 1.0)));
        const colour = mix(C.rgb, vec3(1), clamp(beam.mul(knot).mul(0.5), 0, 0.7));
        const cap = shock.mul(isAmbient.select(0.18, 0.6)).add(glow.mul(isAmbient.select(0.4, 1.0)));
        const rgb = colour.mul(core.mul(2.2).add(cap))
            .mul(lightNow).mul(isAmbient.select(0.65, 1.0)).mul(u.iris)
            .mul(edge);
        return vec4(rgb, 0);
    })();
    return nfPart('jets', geometry, material, 14);
}

function step1(x) {
    return x.greaterThanEqual(0).select(1, 0);
}

/** The sparks: one per birth slot, flying from the card's edge to the site before ignition. */
export function createFlights(u) {
    const slot = new Float32Array(BIRTH_SLOTS);
    for (let i = 0; i < BIRTH_SLOTS; i += 1) slot[i] = i;
    const geometry = nfQuadGeometry(BIRTH_SLOTS, { aSlot: { array: slot, size: 1 } });
    const material = nfLightMaterial();
    const base = int(attribute('aSlot', 'float').add(0.5)).mul(BIRTH_ROWS);
    const A = u.births.element(base);
    const C = u.births.element(base.add(1));
    const F = u.births.element(base.add(5));
    const dur = max(F.z, 1e-3);
    const since = u.time.sub(A.z.sub(dur));
    const active = A.w.greaterThan(0.001).and(F.z.greaterThan(0.01)).and(since.greaterThan(0))
        .and(since.lessThan(dur.add(0.3)));
    const k = clamp(since.div(dur), 0, 1);
    const prog = k.mul(k).mul(float(3).sub(k.mul(2))).mul(0.35).add(k.mul(0.65));
    // from the card's edge (still) into the dust (which the nursery pass shows at its place − cam)
    const from = F.xy;
    const to = A.xy.sub(u.cam);
    const chord = to.sub(from);
    const ctrl = from.add(to).mul(0.5).add(normalize(vec2(chord.y.negate(), chord.x)).mul(F.w).mul(length(chord)));
    const bez = (s) => {
        const a = mix(from, ctrl, s);
        const b = mix(ctrl, to, s);
        return mix(a, b, s);
    };
    const head = bez(prog);
    const tail = bez(max(prog.sub(0.26), 0));
    const axis = head.sub(tail);
    const lenH = max(length(axis), 1e-4);
    const dirH = axis.div(lenH);
    const sideH = vec2(dirH.y.negate(), dirH.x);
    const halfW = float(0.03);
    const t01 = positionGeometry.y.add(1).mul(0.5);
    const centre = mix(tail.sub(dirH.mul(0.01)), head.add(dirH.mul(halfW)), t01)
        .add(sideH.mul(positionGeometry.x.mul(halfW)));
    material.vertexNode = clip(u, active.select(centre, vec2(0, -10)));
    material.colorNode = vec4(0, 0, 0, 1);
    material.outputNode = Fn(() => {
        const s = t01.mul(lenH.add(halfW.add(0.01))).sub(0.01);
        const x = positionGeometry.x.mul(halfW);
        const trail = nfGauss(x.div(0.0035)).mul(pow(clamp(s.div(lenH), 0, 1), 1.6))
            .mul(step1(lenH.sub(s)));
        const h = length(vec2(s.sub(lenH), x));
        const headGlow = nfGauss(h.div(0.006)).mul(2.0).add(nfGauss(h.div(0.022)).mul(0.45));
        const fade = float(1).sub(smoothstep(dur, dur.add(0.3), since));
        const rgb = mix(C.rgb, vec3(1), 0.45).mul(trail.mul(1.4).add(headGlow)).mul(fade).mul(u.iris);
        return vec4(rgb, 0);
    })();
    return nfPart('flights', geometry, material, 16);
}

/** Blades a clear sends out of the card, one per side per cleared row. */
export const BLADE_SLOTS = 8;
/** Seconds a blade takes to run out, and nursery units a second it runs. */
export const BLADE_LIFE = 1.4;
export const BLADE_SPEED = 2.4;

export function createBlades(u) {
    const count = BLADE_SLOTS * 2;
    const table = Array.from({ length: BLADE_SLOTS * 2 }, () => new THREE.Vector4(0, -10, -100, 0));
    const rows = uniformArray(table, 'vec4');
    const blade = new Float32Array(count * 2);
    for (let i = 0; i < count; i += 1) {
        blade[i * 2] = Math.floor(i / 2);
        blade[i * 2 + 1] = i % 2 === 0 ? -1 : 1;
    }
    const geometry = nfQuadGeometry(count, { aBlade: { array: blade, size: 2 } });
    const material = nfLightMaterial();
    const aBlade = attribute('aBlade', 'vec2');
    const base = int(aBlade.x.add(0.5)).mul(2);
    // (row y, start time, card's left x, card's right x) + (r, g, b, strength)
    const A = rows.element(base);
    const C = rows.element(base.add(1));
    const age = u.time.sub(A.y);
    const active = C.w.greaterThan(0.001).and(age.greaterThan(0)).and(age.lessThan(BLADE_LIFE));
    const sideX = aBlade.y;
    const edge = sideX.lessThan(0).select(A.z, A.w);
    const reachX = sideX.mul(u.aspect.mul(1.05)).sub(edge).abs();
    const run = min(age.mul(BLADE_SPEED), reachX);
    const halfH = float(0.05);
    const t01 = positionGeometry.x.add(1).mul(0.5);
    const centre = vec2(edge.add(sideX.mul(t01.mul(run.add(0.04)))), A.x.add(positionGeometry.y.mul(halfH)));
    material.vertexNode = clip(u, active.select(centre, vec2(0, -10)));
    material.colorNode = vec4(0, 0, 0, 1);
    material.outputNode = Fn(() => {
        const s = t01.mul(run.add(0.04));
        const y = positionGeometry.y.mul(halfH);
        const thin = nfGauss(y.div(0.004)).mul(0.8).add(nfGauss(y.div(0.016)).mul(0.45));
        const head = nfGauss(s.sub(run).div(0.03));
        const trail = exp(run.sub(s).max(0).mul(-2.2)).mul(step1(run.sub(s)));
        const fade = float(1).sub(smoothstep(BLADE_LIFE * 0.45, BLADE_LIFE, age));
        const rgb = mix(C.rgb, vec3(1), 0.35).mul(thin).mul(trail.mul(0.9).add(head.mul(2.2))).mul(C.w)
            .mul(fade)
            .mul(u.iris);
        return vec4(rgb, 0);
    })();
    const part = nfPart('blades', geometry, material, 18);
    /**
     * A blade at a row's height out of both sides of a card (nursery units). It takes a spent
     * slot, else the one that started longest ago: quick clears and a cascade's waves never cut
     * short a blade still crossing while an older one is there to give.
     */
    part.fire = (y, time, left, right, rgb, strength = 1) => {
        let i = 0;
        let oldest = Infinity;
        for (let k = 0; k < BLADE_SLOTS; k += 1) {
            const start = table[k * 2].y;
            const spent = !(table[k * 2 + 1].w > 0) || time - start > BLADE_LIFE;
            const order = spent ? -Infinity : start;
            if (order < oldest) {
                oldest = order;
                i = k;
            }
        }
        table[i * 2].set(y, time, left, right);
        table[i * 2 + 1].set(rgb[0], rgb[1], rgb[2], strength);
    };
    part.reset = () => {
        for (let i = 0; i < BLADE_SLOTS; i += 1) {
            table[i * 2].set(0, -10, -100, 0);
            table[i * 2 + 1].set(0, 0, 0, 0);
        }
    };
    part.table = table;
    return part;
}

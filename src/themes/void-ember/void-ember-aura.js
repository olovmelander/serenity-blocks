/**
 * Void Ember — the aura: the great set pieces, drawn round the star.
 *
 * One sheet through the star's centre, square to the line of sight (the corona's own plane), that
 * is nothing at all until one of three things happens, each with a shape of its own so no two
 * events read alike:
 *
 *  - jets      four lines. Two beams leave the star's poles and cross the frame, knots of plasma
 *              running out along them behind a bright head.
 *  - pinwheel  a twist. Arms of plasma sweep out of the star in an open spiral that turns as it
 *              grows, the other way each time.
 *  - streamers a perfect clear. The corona opens into long thin rays, each in one of the pieces'
 *              own flames, that stand for seconds like the corona of an eclipse.
 *
 * (What four lines leave behind, a new shell of dust, is the sky's: void-ember-sky.js.)
 *
 * Everything is a closed form of the clock and each piece's own birth time. While none is alive
 * the sheet has no size (uniforms.live = 0), so at rest it costs nothing.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    cameraProjectionMatrix,
    cameraViewMatrix,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    log,
    max,
    mix,
    positionGeometry,
    sign,
    sin,
    smoothstep,
    uniform,
    uniformArray,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    TAU, veFxMaterial, veHash11, vePart,
} from './void-ember-tsl.js';

/** How many star radii the sheet reaches (the frame's far corner is about five from the star). */
export const AURA_REACH = 7.5;
/** Seconds each piece is drawn for. */
export const JET_LIFE = 3.4;
export const PINWHEEL_LIFE = 3.6;
export const STREAMER_LIFE = 8;
/** Rays in the streamers' two fans. */
export const STREAMER_RAYS = Object.freeze([13, 8]);
/** How fast a pinwheel's arm runs round as it runs out: radians per e-fold of radius. */
export const PINWHEEL_WIND = 1.25;

/**
 * @param {object} u  shared uniforms
 * @param {object} opts
 * @param {number} [opts.detail=2]  0 = no noise in the jets, the pinwheel and the streamers
 */
export function createAura(u, { detail = 2 } = {}) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = veFxMaterial('VoidEmberAura');
    const dead = () => new THREE.Vector4(-100, 0, 0, 0);
    const uniforms = {
        /** 1 while anything here is alive: the sheet has no size otherwise. */
        live: uniform(0),
        /** (birth, strength, seed, _) */
        jets: uniform(dead()),
        /** (birth, strength, which way it winds ±1, arms) and its fire. */
        pinwheel: uniform(new THREE.Vector4(-100, 0, 1, 4)),
        pinwheelColor: uniform(new THREE.Vector3(1, 0.6, 0.2)),
        /** (birth, strength, seed, _) */
        streamers: uniform(dead()),
        /** The flames the streamers burn in. */
        flames: uniformArray(Array.from({ length: 6 }, () => new THREE.Vector3(1, 0.6, 0.2)), 'vec3'),
    };

    const viewCentre = cameraViewMatrix.mul(vec4(u.centre, 1.0)).xyz;
    const size = u.radius.mul(AURA_REACH * 2).mul(uniforms.live);
    material.vertexNode = cameraProjectionMatrix.mul(vec4(
        viewCentre.add(vec3(positionGeometry.xy.mul(size), 0.0)),
        1.0,
    ));

    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(AURA_REACH * 2).toVar();
        const b = max(length(q), 1e-4).toVar();
        const dir = q.div(b).toVar();
        const out = max(b.sub(1.0), 0.0).toVar();
        const phi = atan(dir.y, dir.x).toVar();
        const col = vec3(0.0).toVar();

        // ── Jets: two beams out of the poles ──
        If(uniforms.jets.y.greaterThan(0.001), () => {
            const tau = u.time.sub(uniforms.jets.x).toVar();
            If(tau.greaterThan(0.0).and(tau.lessThan(JET_LIFE)), () => {
                const s = dot(q, u.axis2).toVar();
                const a = abs(s).toVar();
                const p = dot(q, vec2(u.axis2.y.negate(), u.axis2.x)).toVar();
                // The head leaves fast and slows; the beam behind it opens a little as it goes.
                const head = tau.div(0.5).pow(0.72).mul(4.6).add(0.9)
                    .toVar();
                const w = max(a.sub(0.9), 0.0).mul(0.055).add(0.05).toVar();
                const x = p.div(w).toVar();
                const core = exp(x.mul(x).negate()).toVar();
                const sheath = exp(abs(x).mul(-0.42)).mul(0.14);
                let knots = float(0.8);
                if (detail >= 1) {
                    // Knots of plasma run out along the beam, each pole's its own.
                    const n = u.noise3(vec3(a.mul(1.7).sub(tau.mul(6.5)), x.mul(0.3), sign(s).mul(3.0).add(uniforms.jets.z)));
                    knots = n.x.mul(n.x).mul(1.9).add(0.3);
                }
                const reached = float(1.0).sub(smoothstep(head.sub(0.3), head, a));
                const lead = a.sub(head);
                const tip = exp(lead.mul(lead).mul(-7.0)).mul(exp(tau.mul(-1.6))).mul(1.8);
                const along = float(1.0).div(a.mul(0.2).add(0.8)).mul(smoothstep(0.86, 1.25, a));
                const fade = exp(max(tau.sub(0.55), 0.0).div(-0.8))
                    .mul(float(1.0).sub(smoothstep(JET_LIFE - 0.9, JET_LIFE, tau)));
                const k = core.mul(knots).add(sheath).mul(reached).mul(along)
                    .add(core.mul(tip).mul(along))
                    .mul(fade)
                    .mul(uniforms.jets.y);
                // White-gold down its middle, the nova's fire round it.
                const hot = mix(vec3(1.0, 0.5, 0.12), vec3(1.0, 0.92, 0.76), core.mul(0.85));
                col.addAssign(hot.mul(k).mul(3.4));
            });
        });

        // ── Pinwheel: arms that sweep out of the star and turn ──
        If(uniforms.pinwheel.y.greaterThan(0.001), () => {
            const tau = u.time.sub(uniforms.pinwheel.x).toVar();
            If(tau.greaterThan(0.0).and(tau.lessThan(PINWHEEL_LIFE)), () => {
                const hand = uniforms.pinwheel.z;
                // An open logarithmic spiral (a wheel of arms, never rings): each arm's angle runs
                // on with the logarithm of the radius. The wheel spins up fast and slows.
                const turn = tau.mul(2.6).sub(tau.mul(tau).mul(0.34));
                const psi = phi.mul(hand).sub(log(b).mul(PINWHEEL_WIND)).add(turn).mul(uniforms.pinwheel.w);
                // How far round from the nearest arm, as a length along the circle here (radii): an
                // arm is a line of light of one thickness all the way out, with a wake on its lee.
                const off = fract(psi.div(TAU).add(0.5)).sub(0.5).mul(TAU).div(uniforms.pinwheel.w)
                    .mul(b)
                    .toVar();
                const thin = out.mul(0.02).add(0.04);
                const arm = exp(off.mul(off).div(thin.mul(thin)).negate()).toVar();
                const wake = exp(max(off, 0.0).div(-0.34)).mul(smoothstep(0.0, 0.04, off)).mul(0.3);
                const front = float(1.0).sub(exp(tau.mul(-1.7))).mul(3.3).add(0.12)
                    .toVar();
                const reached = float(1.0).sub(smoothstep(front.mul(0.55), front, out));
                let knots = float(1.0);
                if (detail >= 1) {
                    // Streaks along the arm (read in the arm's own coordinates), so it is torn plasma.
                    const n = u.noise3(vec3(dir.mul(2.4), log(b).mul(5.0).sub(tau.mul(1.6))));
                    knots = n.x.mul(1.5).add(0.3);
                }
                const fall = float(1.0).div(out.mul(0.8).add(1.0));
                const fade = smoothstep(0.0, 0.12, tau).mul(exp(max(tau.sub(0.9), 0.0).div(-0.8)))
                    .mul(float(1.0).sub(smoothstep(PINWHEEL_LIFE - 0.9, PINWHEEL_LIFE, tau)));
                const k = arm.mul(knots).add(wake).mul(reached).mul(fall)
                    .mul(fade)
                    .mul(uniforms.pinwheel.y)
                    .mul(smoothstep(0.97, 1.14, b));
                const hot = mix(uniforms.pinwheelColor, vec3(1.0, 0.92, 0.76), arm.mul(0.6));
                col.addAssign(hot.mul(k).mul(3.6));
            });
        });

        // ── Streamers: the corona opened into long rays, each its own flame ──
        If(uniforms.streamers.y.greaterThan(0.001), () => {
            const tau = u.time.sub(uniforms.streamers.x).toVar();
            If(tau.greaterThan(0.0).and(tau.lessThan(STREAMER_LIFE)), () => {
                const round = phi.div(TAU).add(0.5).toVar();
                const stand = smoothstep(0.0, 0.25, tau).mul(exp(max(tau.sub(3.8), 0.0).div(-1.6)))
                    .mul(float(1.0).sub(smoothstep(STREAMER_LIFE - 1.2, STREAMER_LIFE, tau))).toVar();
                const fan = (rays, salt, gain) => {
                    // The fan sways as one, a breath each way.
                    const at = round.add(sin(tau.mul(0.55).add(salt)).mul(0.0035)).add(salt * 0.013).mul(rays);
                    const id = floor(at);
                    const h = veHash11(id.add(uniforms.streamers.z).add(salt * 31 + 3));
                    const h2 = veHash11(id.add(uniforms.streamers.z).add(salt * 17 + 59));
                    const reachR = h.mul(2.5).add(2.3).mul(smoothstep(0.0, 1.0, tau.div(h2.mul(0.5).add(0.55))));
                    // A ray narrows as it leaves: a petal, not a wedge.
                    const w = float(0.1).div(out.mul(0.5).add(1.0)).mul(h2.mul(0.7).add(0.5));
                    const x = fract(at).sub(0.5).sub(h.sub(0.5).mul(0.3)).div(w);
                    const petal = exp(x.mul(x).negate());
                    const far = out.div(max(reachR, 0.05));
                    const run = exp(far.mul(-2.9)).mul(float(1.0).sub(smoothstep(0.75, 1.2, far)));
                    let fine = float(1.0);
                    if (detail >= 1) {
                        // Fine threads along the ray, streaming outward.
                        fine = u.noise3(vec3(at.mul(3.3), out.mul(0.6).sub(tau.mul(0.22)), salt + 5.0)).x.mul(1.1).add(0.45);
                    }
                    const flame = uniforms.flames.element(int(id.add(salt * 2).mod(6.0)));
                    const light = mix(flame, vec3(1.0, 0.94, 0.84), petal.mul(petal).mul(0.22));
                    return light.mul(petal.mul(run).mul(fine).mul(gain));
                };
                const rays = fan(STREAMER_RAYS[0], 0, 1.0).add(fan(STREAMER_RAYS[1], 1, 0.75));
                col.addAssign(rays.mul(stand).mul(uniforms.streamers.y).mul(smoothstep(0.97, 1.12, b)).mul(1.7));
            });
        });

        // The sheet's own edge is never seen.
        const rim = float(1.0).sub(smoothstep(AURA_REACH * 0.8, AURA_REACH * 0.98, b));
        return vec4(col.mul(rim).mul(u.breath).mul(u.iris), 0.0);
    })();

    const part = vePart('VoidEmberAura', geometry, material, 12);
    part.uniforms = uniforms;

    /** A piece's strength while it is alive (or still to come), else 0. */
    const left = (row, life, time) => (row.y > 0 && time - row.x < life ? row.y : 0);
    part.fireJets = (time, strength = 1, seed = 0) => {
        uniforms.jets.value.set(time, strength, seed % 7, 0);
    };
    part.firePinwheel = (time, strength, rgb, hand = 1, arms = 4) => {
        uniforms.pinwheel.value.set(time, strength, hand < 0 ? -1 : 1, arms);
        uniforms.pinwheelColor.value.set(rgb[0], rgb[1], rgb[2]);
    };
    part.fireStreamers = (time, strength = 1, seed = 0) => {
        uniforms.streamers.value.set(time, strength, seed % 11, 0);
    };
    part.setFlames = (list) => {
        for (let i = 0; i < 6; i++) {
            const c = list[i % list.length];
            uniforms.flames.array[i].set(c[0], c[1], c[2]);
        }
    };
    /** Call once a frame: sizes the sheet (nothing alive, nothing drawn). */
    part.update = (time) => {
        const alive = left(uniforms.jets.value, JET_LIFE, time) + left(uniforms.pinwheel.value, PINWHEEL_LIFE, time)
            + left(uniforms.streamers.value, STREAMER_LIFE, time);
        uniforms.live.value = alive > 0 ? 1 : 0;
        return alive > 0;
    };
    part.reset = () => {
        uniforms.jets.value.set(-100, 0, 0, 0);
        uniforms.pinwheel.value.set(-100, 0, 1, 4);
        uniforms.streamers.value.set(-100, 0, 0, 0);
        uniforms.live.value = 0;
    };
    return part;
}

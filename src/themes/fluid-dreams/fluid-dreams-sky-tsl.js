/**
 * Fluid Dreams — the sky as the liquid sees it: one function of a direction.
 *
 * The liquid material (fluid-dreams-liquid.js) reads the sky four ways, and each pays only for
 * what it can show:
 *
 *   'full'    a view ray that met no liquid: everything (the ink lit by the sun and torn at its
 *             edges, the bars of cloud on the sea line, the star river, the far forms, the
 *             bubbles, a falling star, the events' lights)
 *   'mirror'  what the sea and the drops mirror: the same sky without what is too fine to
 *             survive a rippled mirror (stars, far forms, the ink's second and third reads)
 *   'lens'    what a drop holds upside down: as the mirror, without the bubbles and the bars
 *   'air'     the colour of the air on the sea line, for the haze: no texture read at all
 *
 * Everything here is inlined at each call (a helper that reads uniforms and a texture cannot be a
 * laid-out function, gotcha #81), so what a mode leaves out is left out in JavaScript.
 *
 * The far forms are bodies of revolution, so their lens needs no march: across a body of
 * revolution the normal is known from where the pixel lies between its outline and its axis.
 * The bubbles are spheres met by the ray in closed form: a skin that mirrors the sky, thin-film
 * colours that sag toward the underside, and the sun twice (on the near skin and, turned over,
 * on the far one).
 */
import {
    If, Loop, abs, acos, clamp, cos, dot, exp, float, floor, int, length, max, mix, normalize, reflect,
    select, sin, smoothstep, sqrt, vec2, vec3,
} from 'three/tsl';
import { TAU } from './fluid-dreams-core.js';
import { FAR_BAND, FAR_COUNT } from './fluid-dreams-sky.js';
import { fdHash33 } from './fluid-dreams-tsl.js';

/** The colour a four-line clear fires in (fluid-dreams-core.js DREAMFIRE), as a literal. */
const FIRE = [1.0, 0.86, 0.62];
/** Interference: one over the wavelengths of red, green and blue (µm). */
const WAVES = [1 / 0.65, 1 / 0.532, 1 / 0.45];

/**
 * @param {object} options
 * @param {object} options.u the liquid's uniforms (createLiquidUniforms)
 * @param {(uv: any, lod?: any) => any} options.noiseAt the noise tile at an explicit level
 * @param {any} options.keyDir the key light's direction (a literal vec3)
 * @param {boolean} options.stars resolve stars and the star river
 * @param {boolean} options.warp fold the ink through itself (two more reads)
 * @param {boolean} options.lit light the ink from the sun's side and tear its edges (two more reads)
 * @param {boolean} options.strata the bars of cloud on the sea line (one read)
 * @param {boolean} options.farForms the liquid forms far out on the sea
 * @param {boolean} options.bubbles the bubbles adrift overhead
 * @param {boolean} options.mirrorSky the mirror also shows the bars
 * @param {boolean} options.mirrorBubbles the mirror also shows the bubbles
 * @returns {(dir: any, mode: 'full'|'mirror'|'lens'|'air') => any}
 */
export function createSkyColour({
    u, noiseAt, keyDir, stars = true, warp = true, lit = true, strata = true, farForms = true, bubbles = true,
    mirrorSky = true, mirrorBubbles = true,
}) {
    /** The bubbles: spheres the ray meets in closed form. Arithmetic only (it is under a per-pixel branch). */
    const drawBubbles = (c, dir) => {
        If(dir.y.greaterThan(0.0).and(u.skyCounts.x.greaterThan(0.5)), () => Loop({
            start: int(FAR_COUNT), end: int(u.skyCounts.x).add(FAR_COUNT), type: 'int', condition: '<', name: 'bb',
        }, ({ bb }) => {
            const A = u.sky.element(bb.mul(2));
            const B = u.sky.element(bb.mul(2).add(1));
            const off = dir.sub(A.xyz).div(A.w).toVar();
            const r2 = dot(off, off).toVar();
            If(r2.lessThan(1.0).and(B.z.greaterThan(0.004)), () => {
                const nz = sqrt(float(1.0).sub(r2)).toVar();
                // the near skin's normal: across the disc by the offset, toward the eye by what is left
                const n = normalize(off.sub(dir.mul(nz))).toVar();
                const rd = reflect(dir, n).toVar();
                // what the skin mirrors: the sky's ground that way, darker where it looks into the sea
                const ry = abs(rd.y).toVar();
                const env = mix(u.horizon.mul(1.15), u.mid.mul(1.3), smoothstep(0.0, 0.22, ry)).toVar();
                env.assign(mix(env, u.zenith.mul(2.2), smoothstep(0.15, 0.7, ry)));
                env.mulAssign(select(rd.y.lessThan(0.0), 0.7, 1.0));
                const rim = float(1.0).sub(nz).toVar();
                const fres = rim.mul(rim).mul(rim).mul(0.92).add(0.04);
                // the film: thin overhead, heavy underneath, a slow swirl in it
                const thick = B.x.mul(0.5).add(0.3).sub(off.y.mul(0.17))
                    .add(sin(off.x.mul(3.1).add(u.time.mul(0.35)).add(B.x.mul(40.0))).mul(0.05))
                    .add(u.film.y);
                const cosT = sqrt(float(1.0).sub(float(1.0).sub(nz.mul(nz)).mul(0.5653)));
                const ir = cos(vec3(...WAVES).mul(thick.mul(2.66).mul(cosT)).mul(TAU)).mul(0.5).add(0.5);
                // the sun twice: on the near skin and, turned over, on the far one
                const g1 = clamp(dot(rd, u.sunDir), 0.0, 1.0).toVar();
                const g2 = clamp(dot(reflect(dir, normalize(off.add(dir.mul(nz)))), u.sunDir), 0.0, 1.0).toVar();
                const p8 = (v) => {
                    const v2 = v.mul(v);
                    const v4 = v2.mul(v2);
                    return v4.mul(v4);
                };
                const g1p = p8(p8(g1));
                const g2p = p8(p8(g2));
                const tint = mix(u.inkA, u.inkB, B.y);
                const rim4 = rim.mul(rim).mul(rim).mul(rim);
                const light = env.mul(ir.mul(1.7).add(0.25)).mul(fres.mul(5.6).add(0.14))
                    .add(tint.add(u.horizon).mul(ir.mul(0.8).add(0.2)).mul(rim4.mul(0.9)))
                    .add(u.sun.mul(g1p.mul(3.2).add(g2p.mul(1.4))));
                const a = float(1.0).sub(smoothstep(0.86, 1.0, r2)).mul(B.z);
                c.assign(mix(c, c.mul(0.95).add(light), a));
            });
        }));
    };

    return (dirIn, mode = 'lens') => {
        const full = mode === 'full';
        const mirror = mode === 'mirror';
        const air = mode === 'air';
        const dir = vec3(dirIn).toVar();
        const ay = abs(dir.y).toVar();
        const c = mix(u.horizon, u.mid, smoothstep(0.0, 0.13, ay)).toVar();
        c.assign(mix(c, u.zenith, smoothstep(0.08, 0.62, ay)));
        // a band of light lying on the sea line
        c.addAssign(u.horizon.mul(exp(ay.mul(-24.0)).mul(0.5)));
        const up = vec3(dir.x, ay, dir.z).toVar();

        // ── the dream sun ──
        const cs = clamp(dot(up, u.sunDir), 0.0, 1.0).toVar();
        const cs4 = cs.mul(cs).mul(cs).mul(cs).toVar();
        const cs16 = cs4.mul(cs4).mul(cs4).mul(cs4).toVar();
        const cs64 = cs16.mul(cs16).mul(cs16).mul(cs16);
        const disc = smoothstep(0.99895, 0.99978, cs).toVar();
        c.addAssign(u.sun.mul(cs4.mul(cs4).mul(0.2).add(cs64.mul(0.9)).add(disc.mul(6.0))));
        // its limb: a rim of the sea line's own colour round the disc
        c.addAssign(u.horizon.mul(smoothstep(0.9974, 0.99895, cs).mul(float(1.0).sub(disc)).mul(0.75)));
        // how far from the sun (the chord of the angle: radians, for the angles the frame holds)
        const away = sqrt(max(float(2.0).sub(cs.mul(2.0)), 0.0)).toVar();
        // the ring it wears in mist, and the second one a perfect clear opens round it
        // (only where a ring can show: within about 26° of the sun; the rest of the sky skips it)
        If(cs.greaterThan(0.9), () => {
            const h1 = away.sub(0.2).div(0.017).toVar();
            const h2 = away.sub(0.36).div(0.026).toVar();
            // (red on its inner edge, the sea's glow on its outer, as a ring of ice has)
            c.addAssign(mix(u.sun, u.glow, smoothstep(-1.0, 1.0, h1)).mul(exp(h1.mul(h1).negate()).mul(u.sunLook.x)));
            c.addAssign(mix(u.sun, u.glow, smoothstep(-1.0, 1.0, h2)).mul(exp(h2.mul(h2).negate()).mul(u.sunLook.y)));
        });
        // opposite the sun the sky keeps a belt of the third ink's colour over the sea line
        const anti = clamp(dot(up.xz, u.sunFlat).negate(), 0.0, 1.0).toVar();
        c.addAssign(u.inkC.mul(anti.mul(anti).mul(exp(ay.mul(-4.5))).mul(smoothstep(0.0, 0.06, ay)).mul(0.075)));

        /** Mist on the sea line, and a level's front of light: every mode wears them. */
        const veil = () => {
            const mistCol = u.horizon.mul(0.82).add(u.sun.mul(cs4.mul(0.3)));
            c.assign(mix(c, mistCol, u.air.z.mul(exp(ay.mul(-13.0)))));
            If(u.front.y.greaterThan(0.002), () => {
                const x = away.sub(u.front.x).div(u.front.z).toVar();
                c.addAssign(mix(u.sun, vec3(1.0), 0.35).mul(exp(x.mul(x).negate()).mul(u.front.y)));
                // behind the front the new dusk stands a little brighter for a moment
                c.mulAssign(smoothstep(0.0, 0.5, u.front.x.sub(away)).mul(u.front.y).mul(0.24).add(1.0));
            });
        };
        if (air) {
            veil();
            c.mulAssign(u.skyFlash.mul(0.3).add(1.0));
            return c;
        }

        // a soft light behind the viewer: never seen itself, it is the window in every drop
        const key = clamp(dot(dir, keyDir), 0.0, 1.0).toVar();
        const key8 = key.mul(key).mul(key).mul(key).mul(key)
            .mul(key)
            .mul(key)
            .mul(key)
            .toVar();
        c.addAssign(mix(u.glow, vec3(1.0), 0.6).mul(key8.mul(key8).mul(key8).mul(2.6)));

        // ── ink adrift overhead, receding to the sea line like a ceiling of cloud ──
        const P = up.xz.div(ay.add(0.3)).toVar();
        // a twist's funnel turns the ink over it
        If(u.swirl.z.greaterThan(0.001), () => {
            const v = P.sub(u.swirl.xy).toVar();
            const a = u.swirl.z.mul(exp(dot(v, v).div(u.swirl.w.mul(u.swirl.w)).negate())).toVar();
            const ca = cos(a).toVar();
            const sa = sin(a).toVar();
            P.assign(u.swirl.xy.add(vec2(v.x.mul(ca).sub(v.y.mul(sa)), v.x.mul(sa).add(v.y.mul(ca)))));
        });
        // a four-line clear drives a ring out through it: the ink is pushed ahead of the ring
        const push = float(0.0).toVar();
        if (full || mirror) {
            If(u.shock.w.greaterThan(0.002), () => {
                const v = P.sub(u.shock.xy).toVar();
                const rho = max(length(v), 1e-3).toVar();
                const x = rho.sub(u.shock.z).div(0.2).toVar();
                push.assign(exp(x.mul(x).negate()).mul(u.shock.w));
                P.subAssign(v.div(rho).mul(push.mul(0.3)));
            });
        }
        const drift = vec2(u.skyClock.mul(0.0042), u.skyClock.mul(0.0027)).toVar();
        const n1 = noiseAt(P.mul(0.105).add(drift)).w.toVar();
        const n2 = n1.toVar();
        if (full && warp) {
            // (the fold moves against the drift: the ink forms and melts as it goes, it does not only slide)
            const fold = noiseAt(P.mul(0.19).sub(drift.mul(1.7)).add(0.37)).w.toVar();
            n2.assign(noiseAt(P.mul(0.26).add(vec2(n1, fold).mul(0.32)).add(drift.mul(2.3))).w);
        }
        const field = n1.mul(0.62).add(n2.mul(0.5)).toVar();
        const face = float(0.0).toVar();
        const lo = mix(0.62, 0.26, u.air.x).toVar();
        if (full && lit) {
            // (The fine field moves the ink's edge by 0.06 at most: where the field stands further
            // under the ink's threshold than that there is no ink either way, and both reads are spared.)
            If(field.greaterThan(lo.sub(0.07)), () => {
                // torn edges: the fine field pulls the ink's outline into threads, as ink in water
                const fine = noiseAt(P.mul(0.57).add(vec2(n2, n1).mul(0.4)).sub(drift.mul(3.1))).x.toVar();
                // which side faces the sun: the same field read a step toward it in the ink's own plane
                const toSun = u.sunDeck.sub(P).toVar();
                const stepTo = toSun.div(max(length(toSun), 0.4)).mul(0.5);
                const sunward = noiseAt(P.add(stepTo).mul(0.105).add(drift)).w.mul(0.62).add(n2.mul(0.5))
                    .add(fine.sub(0.5).mul(0.12))
                    .toVar();
                field.addAssign(fine.sub(0.5).mul(0.12));
                face.assign(clamp(field.sub(sunward).mul(8.0), -1.0, 1.0));
            });
        }
        const band = smoothstep(0.02, 0.3, ay).mul(float(1.0).sub(smoothstep(0.7, 1.0, ay).mul(0.45)));
        const dens = smoothstep(lo, lo.add(0.42), field).mul(band).toVar();
        const hue = mix(mix(u.inkA, u.inkB, smoothstep(0.3, 0.68, n2)), u.inkC, smoothstep(0.5, 0.9, n1).mul(0.55));
        const level = u.charge.mul(0.7).add(0.5).add(u.surge.mul(0.4))
            .add(u.heat.x.mul(0.12))
            .add(u.heat.y.mul(0.2));
        // The ink is a body: it hides some of what is behind it, wears its own light on the side
        // the sun is on, and keeps a deeper heart.
        const heart = smoothstep(0.4, 1.0, dens);
        c.mulAssign(float(1.0).sub(dens.mul(0.42)));
        c.addAssign(hue.mul(dens).mul(level).mul(face.mul(0.42).add(0.86))
            .mul(float(1.0).sub(heart.mul(0.3))));
        if (full && lit) {
            // its sunward edges burn in the sun's own light, most toward the sun
            const edge = dens.mul(float(1.0).sub(dens)).mul(4.0);
            c.addAssign(u.sun.mul(edge.mul(max(face, 0.0)).mul(cs4.mul(1.5).add(0.2)).mul(0.42)));
        }
        if (full || mirror) {
            // the ring through the ink carries light of its own
            c.addAssign(mix(u.sun, u.glow, 0.5).mul(push.mul(band).mul(0.3)));
        }

        // ── bars of cloud lying along the sea line, seen from the side ──
        if (strata && (full || (mirror && mirrorSky))) {
            If(ay.greaterThan(0.006).and(ay.lessThan(0.26)), () => {
                const bear = up.x.div(max(length(up.xz), 1e-3));
                const sN = noiseAt(vec2(
                    bear.mul(1.15).add(u.skyClock.mul(0.0011)),
                    ay.mul(7.5).add(u.skyClock.mul(0.0004)).add(0.31),
                )).w.toVar();
                const sLo = mix(0.8, 0.44, u.air.y).toVar();
                const bars = smoothstep(sLo, sLo.add(0.16), sN)
                    .mul(smoothstep(0.006, 0.03, ay))
                    .mul(float(1.0).sub(smoothstep(0.1, 0.26, ay)))
                    .toVar();
                // dark against the dusk far from the sun, burning near it
                const barCol = mix(
                    u.mid.mul(1.1).add(u.horizon.mul(0.32)),
                    u.sun.mul(0.85).add(u.horizon.mul(0.5)),
                    cs4.mul(cs4).mul(0.9),
                );
                c.assign(mix(c, barCol, bars.mul(0.7)));
            });
        }

        if (full) {
            if (stars) {
                // the star river: a great circle of the sky where the stars crowd, with a milk of
                // light between them that the ink's colours run in
                const lat = dot(dir, u.river).toVar();
                const river = exp(lat.mul(lat).mul(-30.0)).toVar();
                const seen = smoothstep(0.03, 0.3, dir.y).mul(float(1.0).sub(dens.mul(0.85))).mul(u.air.w).toVar();
                If(river.mul(seen).greaterThan(0.004), () => {
                    const rN = noiseAt(vec2(dir.x.add(dir.y.mul(0.6)), dir.z.sub(dir.y.mul(0.35))).mul(1.6).add(0.17)).w.toVar();
                    const milk = river.mul(smoothstep(0.25, 0.8, rN).mul(0.85).add(0.15)).mul(seen);
                    c.addAssign(mix(u.inkC, u.inkB, rN).mul(0.7).add(vec3(0.22)).mul(milk.mul(0.09)));
                });

                const starField = (scale, faint, gain) => {
                    const sp = dir.mul(scale).toVar();
                    const cell = floor(sp).toVar();
                    const h = fdHash33(cell).toVar();
                    const off = sp.sub(cell).sub(0.5).sub(h.sub(0.5).mul(0.7));
                    const sigma = max(u.pixelAngle.mul(scale), 0.02);
                    const core = exp(dot(off, off).negate().div(sigma.mul(sigma)));
                    const z2 = h.z.mul(h.z);
                    const z8 = z2.mul(z2).mul(z2).mul(z2);
                    const twinkle = sin(u.time.mul(h.x.mul(3.0).add(1.5)).add(h.y.mul(40.0))).mul(0.3).add(0.7);
                    // a few are warm, a few are the sea's own cyan: most are pale
                    const tint = mix(vec3(1.0, 0.8, 0.86), vec3(0.72, 0.9, 1.0), h.x);
                    return tint.mul(core.mul(z8.mul(h.z).mul(7.0).add(z2.mul(faint))).mul(twinkle).mul(gain));
                };
                c.addAssign(starField(84.0, 0.2, seen.mul(river.mul(0.7).add(0.8))));
                // the river's own dust of faint stars
                If(river.mul(seen).greaterThan(0.2), () => {
                    c.addAssign(starField(133.0, 0.1, river.mul(seen).mul(0.5)));
                });
            }
            if (farForms) {
                // Far out, other forms stand on their own threads: bodies of revolution, each
                // shaded as the lens it is (the sea line bent across its middle, the film, a rim
                // lit from the sun's side).
                If(dir.y.greaterThan(-0.004).and(dir.y.lessThan(FAR_BAND)), () => Loop({
                    start: int(0), end: int(FAR_COUNT), type: 'int', condition: '<', name: 'fd',
                }, ({ fd }) => {
                    const A = u.sky.element(fd.mul(2));
                    const B = u.sky.element(fd.mul(2).add(1));
                    const off = dir.sub(A.xyz).toVar();
                    const inv = float(1.0).div(A.w).toVar();
                    // across it (to the right) and up it, in its own radii
                    const x = off.z.mul(A.x).sub(off.x.mul(A.z)).mul(inv).toVar();
                    const y = off.y.mul(inv).toVar();
                    If(abs(x).lessThan(1.6), () => {
                        const n = vec3(0.0, 0.0, 1.0).toVar();
                        const hit = float(0.0).toVar();
                        const edge = float(1.0).toVar();
                        // its thread: from the sea line up into its underside, flaring at both ends
                        const sea = A.y.mul(inv).negate().toVar();
                        const bottom = B.y.negate().toVar();
                        const w = clamp(
                            float(0.075).add(exp(y.sub(bottom).mul(3.4)).mul(0.5)).add(exp(sea.sub(y).mul(2.2)).mul(0.22)),
                            0.0,
                            0.62,
                        ).toVar();
                        If(y.greaterThan(sea).and(y.lessThan(bottom.mul(0.9))).and(abs(x).lessThan(w)), () => {
                            const sx = x.div(w).toVar();
                            n.assign(vec3(sx, 0.2, sqrt(max(float(1.0).sub(sx.mul(sx)), 0.0))));
                            hit.assign(1.0);
                            edge.assign(float(1.0).sub(abs(sx)));
                        });
                        // a bead resting above it
                        If(B.z.greaterThan(0.05), () => {
                            const bx = x.div(B.z).toVar();
                            const by = y.sub(B.y.add(B.z.mul(0.78))).div(B.z).toVar();
                            const r2 = bx.mul(bx).add(by.mul(by)).toVar();
                            If(r2.lessThan(1.0), () => {
                                n.assign(vec3(bx, by, sqrt(float(1.0).sub(r2))));
                                hit.assign(1.0);
                                edge.assign(float(1.0).sub(r2));
                            });
                        });
                        // its body
                        const qx = x.div(B.x).toVar();
                        const qy = y.div(B.y).toVar();
                        const q2 = qx.mul(qx).add(qy.mul(qy)).toVar();
                        If(q2.lessThan(1.0), () => {
                            n.assign(vec3(qx, qy, sqrt(float(1.0).sub(q2))));
                            hit.assign(1.0);
                            edge.assign(float(1.0).sub(q2));
                        });
                        If(hit.greaterThan(0.5), () => {
                            // a lens turns the picture over: the sea line lies bent across its middle
                            const vy = n.y.toVar();
                            const inner = mix(u.horizon.mul(0.55).add(u.mid.mul(0.5)), u.mid.mul(1.1), smoothstep(-0.3, 0.6, vy))
                                .add(u.horizon.mul(exp(vy.add(0.12).mul(vy.add(0.12)).mul(-11.0)).mul(1.05)));
                            const rim = float(1.0).sub(n.z).toVar();
                            const rim2 = rim.mul(rim).toVar();
                            const film = cos(vec3(0.0, 0.33, 0.67).add(n.z.mul(1.3)).add(A.x.mul(5.0))
                                .add(u.time.mul(0.04))
                                .mul(TAU)).mul(0.5).add(0.5);
                            // the sun stands to one side of it: that rim burns
                            const sunRight = u.sunFlat.y.mul(A.x).sub(u.sunFlat.x.mul(A.z));
                            const sunSide = clamp(n.x.mul(sunRight).mul(1.5).add(0.2), 0.0, 1.0).mul(rim2);
                            // a lens gathers the sun on its far side: a point of light inside it
                            const fx = n.x.add(sunRight.mul(0.42));
                            const fy = n.y.add(0.16);
                            const focus = exp(fx.mul(fx).add(fy.mul(fy)).mul(-16.0));
                            const body = inner
                                .add(film.mul(u.horizon.mul(0.6).add(u.mid.mul(0.8))).mul(rim2.mul(1.6).add(0.1)))
                                .add(u.sun.mul(sunSide.mul(1.5).add(focus.mul(0.75))))
                                .add(mix(u.glow, vec3(...FIRE), 0.4).mul(B.w.mul(n.z.mul(0.6).add(0.4))));
                            c.assign(mix(c, mix(body, c, 0.22), smoothstep(0.0, 0.14, edge)));
                        });
                    });
                }));
            }
        }

        veil();

        if (bubbles && (full || (mirror && mirrorBubbles))) drawBubbles(c, dir);

        if (full) {
            If(u.prism.y.greaterThan(0.001), () => {
                // a ring of split light opening from the Great Drop
                const ang = acos(clamp(dot(dir, u.heroDir), -1.0, 1.0));
                const x = ang.sub(u.prism.x).div(u.prism.z).toVar();
                const bandP = exp(x.mul(x).negate());
                const spec = cos(vec3(0.0, 0.33, 0.67).add(x.mul(0.3)).mul(TAU)).mul(0.5).add(0.5);
                c.addAssign(mix(spec, vec3(1.0), 0.28).mul(bandP).mul(u.prism.y));
            });
            If(u.starHead.w.greaterThan(0.002), () => {
                // a falling star: a hair of light that thins behind its head
                const o = dir.sub(u.starHead.xyz).toVar();
                const behind = dot(o, u.starTail.xyz).negate().toVar();
                const across2 = max(dot(o, o).sub(behind.mul(behind)), 0.0);
                const wide = max(u.pixelAngle.mul(1.6), 0.0019).toVar();
                const trail = exp(across2.div(wide.mul(wide)).negate())
                    .mul(float(1.0).sub(smoothstep(0.0, u.starTail.w, behind)))
                    .mul(smoothstep(wide.negate(), wide, behind));
                const head = exp(dot(o, o).div(wide.mul(wide).mul(5.0)).negate());
                c.addAssign(vec3(1.0, 0.93, 0.86).mul(trail.mul(2.4).add(head.mul(4.0)).mul(u.starHead.w)));
            });
        }
        if (full || mirror) {
            If(u.pillar.z.greaterThan(0.002), () => {
                // the pillar of light a four-line clear stands on its crater
                const flat = up.xz.div(max(length(up.xz), 1e-3));
                const side = length(flat.sub(u.pillar.xy)).toVar();
                const x = side.div(u.pillar.w).toVar();
                const shaft = exp(x.mul(x).negate()).mul(exp(ay.mul(-2.4)));
                const glow = exp(x.mul(x).mul(-0.04)).mul(exp(ay.mul(-5.0))).mul(0.14);
                // (at 2.0 it was a searchlight: white from the sea to the top of the frame)
                c.addAssign(mix(vec3(...FIRE), u.glow, 0.3).mul(shaft.mul(1.25).add(glow).mul(u.pillar.z)));
            });
        }
        // a four-line clear's flash lifts the whole sky; at 0.45 it bleached the half the crown stood in
        c.mulAssign(u.skyFlash.mul(0.3).add(1.0));
        // below the sea line: what a ray that leaves the picture downward meets
        const under = smoothstep(0.0, -0.22, dir.y);
        return mix(c, c.mul(vec3(0.4, 0.36, 0.55)).add(u.deep), under);
    };
}

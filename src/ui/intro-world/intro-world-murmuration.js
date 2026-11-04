/**
 * First Light — the murmuration: one great flock of light round the title and the menu.
 *
 * A long plume of motes whose line the world writes every frame (intro-world-core.js
 * `writeFlockLine`): a slow loop round the wordmark, or a circuit round the menu's stage card, a
 * uniform cubic B-spline of FLOCK_POINTS that the vertex stage reads. Across its body it is a
 * broad, thin sheet that banks and folds: a wave of turning rolls from its head to its tail, and
 * wherever the sheet turns edge on its motes crowd along the line of sight, so its folds draw
 * fine bright lines, as a murmuration's do. It bulges and thins along its length, parts into two
 * soft streams on the out-breath and closes again, and on the breath that gathers it the whole
 * flock pours, head first, into a ring of light fitted to the title, holds it, and unravels.
 *
 * Every quantity is a closed form of time and every mote is placed in the vertex stage from a
 * static seed: no compute, no state, so a seek lands where playing would. Most motes are fine
 * dust, a few are sparks, and a sprinkling are wide and faint, the body of light under the rest;
 * they are additive and premultiplied, with a light budget so the flock keeps its brightness
 * whatever the tier's count.
 *
 * The flock flows round the interface: `setRects` hands it the screen's panels (rounded boxes in
 * frame heights), and a mote pushed against one slides along its edge rather than crossing it, so
 * the flock takes the panel's outline; a mote that does get behind one fades. Behind the menu a
 * small share of the motes leaves the flock for the thread, a fine stream of light from the
 * current row into the stage card.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    pow,
    select,
    sign,
    sin,
    smoothstep,
    step,
    uniform,
    uniformArray,
    uv,
    varyingProperty,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    FLOCK_POINTS, FLOCK_RANK_FIT, TAU, buildMurmurationSeeds, smoothstep as easeBetween,
} from './intro-world-core.js';

/** vec4 rows of the flock's state the world writes each frame (see `write`). */
export const MURMURATION_ROWS = 6;
/** Panels of the interface the motes flow round (see `setRects`). */
export const RECT_SLOTS = 6;
/** The share of the motes that leaves the flock for the thread behind the menu. */
const THREAD_SHARE = 0.03;

/**
 * @param {object} u shared uniforms: time
 * @param {{ count?: number }} [options] count = motes
 */
export function createMurmuration(u, { count = 100000 } = {}) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(buildMurmurationSeeds(count), 4));
    geometry.instanceCount = count;

    const rows = Array.from({ length: MURMURATION_ROWS }, () => new THREE.Vector4());
    const R = uniformArray(rows, 'vec4');
    const points = Array.from({ length: FLOCK_POINTS }, () => new THREE.Vector4());
    const P = uniformArray(points, 'vec4');
    const hues = Array.from({ length: FLOCK_POINTS }, () => new THREE.Vector4());
    const H = uniformArray(hues, 'vec4');
    const threadRows = Array.from({ length: 4 }, () => new THREE.Vector4());
    const L = uniformArray(threadRows, 'vec4');
    const rectBox = Array.from({ length: RECT_SLOTS }, () => new THREE.Vector4(9, 9, 0, 0));
    const rectLaw = Array.from({ length: RECT_SLOTS }, () => new THREE.Vector4());
    const boxNode = uniformArray(rectBox, 'vec4');
    const lawNode = uniformArray(rectLaw, 'vec4');
    const rectCount = uniform(0, 'int');
    const viewHeight = uniform(1080);
    const aspect = uniform(16 / 9);
    const gain = uniform(1);

    const seed = attribute('aSeed', 'vec4');
    const vLight = varyingProperty('vec3', 'flMurmurLight');

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
    });
    material.name = 'FirstLightMurmuration';
    material.fog = false;

    material.vertexNode = Fn(() => {
        const r0 = R.element(int(0)).toVar(); // ring depth, gather, closed round the card, -
        const r1 = R.element(int(1)).toVar(); // width, thickness, split, fold
        const r2 = R.element(int(2)).toVar(); // bank: waves along, phase, amplitude, base
        const r3 = R.element(int(3)).toVar(); // bulge phase, light, swirl, ring tube
        const r4 = R.element(int(4)).toVar(); // the ring: centre x, y; radii x, y
        const r5 = R.element(int(5)).toVar(); // touch pulse: age, origin, strength; -
        const sr = seed.w.toVar();
        const a = seed.y.toVar();
        const rho = seed.z.toVar();

        // ── Along the flock: a density wave squeezes it, the ends taper ──
        const sRaw = seed.x.add(sin(seed.x.mul(TAU * 7).sub(r3.x.mul(2.2))).mul(0.016)).toVar();
        const s = clamp(sRaw, 0.0, 1.0).toVar();
        // A mote's place by rank (intro-world-core.js `FLOCK_RANK_FIT`): round the ring and the
        // frame the motes lie evenly, with a density wave of its own (the wave along s is squeezed
        // into hatch marks here, where the tips' few motes are spread out).
        const even = seed.x.sub(sin(seed.x.mul(TAU)).mul(FLOCK_RANK_FIT / TAU)).toVar();
        const rank = fract(even.add(sin(even.mul(TAU * 7).sub(r3.x.mul(2.2))).mul(0.006))).toVar();
        // Closed round the card its head and tail have met, and it lies evenly round the frame.
        const closed = r0.z.toVar();
        const placed = mix(s, rank, closed).toVar();

        // The flock's line, a uniform cubic B-spline over the world's points.
        const u0 = placed.mul(FLOCK_POINTS - 3).add(1.0).toVar();
        const cell = min(floor(u0), float(FLOCK_POINTS - 3)).toVar();
        const iu = int(cell).toVar();
        const f = u0.sub(cell).toVar();
        const f2 = f.mul(f).toVar();
        const f3 = f2.mul(f).toVar();
        const g1 = float(1.0).sub(f).toVar();
        const b0 = g1.mul(g1).mul(g1).div(6.0).toVar();
        const b1 = f3.mul(3.0).sub(f2.mul(6.0)).add(4.0).div(6.0)
            .toVar();
        const b2 = f3.mul(-3.0).add(f2.mul(3.0)).add(f.mul(3.0)).add(1.0)
            .div(6.0)
            .toVar();
        const b3 = f3.div(6.0).toVar();
        const p0 = P.element(iu.sub(int(1))).toVar();
        const p1 = P.element(iu).toVar();
        const p2 = P.element(iu.add(int(1))).toVar();
        const p3 = P.element(iu.add(int(2))).toVar();
        const line = p0.mul(b0).add(p1.mul(b1)).add(p2.mul(b2)).add(p3.mul(b3))
            .toVar();
        const C = line.xyz.toVar();
        const dT = p0.xyz.mul(g1.mul(g1).mul(-0.5))
            .add(p1.xyz.mul(f2.mul(1.5).sub(f.mul(2.0))))
            .add(p2.xyz.mul(f2.mul(-1.5).add(f).add(0.5)))
            .add(p3.xyz.mul(f2.mul(0.5)));
        const T = normalize(dT).toVar();
        const N = normalize(vec3(T.y, T.x.negate(), 0.0001)).toVar();
        const Bv = cross(T, N).toVar();
        const hue = H.element(iu.sub(int(1))).mul(b0).add(H.element(iu).mul(b1))
            .add(H.element(iu.add(int(1))).mul(b2))
            .add(H.element(iu.add(int(2))).mul(b3))
            .toVar();

        // ── Across it: a broad thin sheet that banks and folds, a wave of turning running down it ──
        // Closed, every wave along it comes round to a whole number, so its ends join as one sheet.
        // (Detuned along the flock otherwise: evenly spaced turns read as a row of fins.)
        const bankPhase = placed.mul(mix(r2.x, 3.0, closed)).mul(TAU)
            .add(sin(placed.mul(TAU).mul(mix(1.37, 1.0, closed)).add(r3.x.mul(0.4))).mul(1.1))
            .sub(r2.y)
            .toVar();
        const beta = r2.w.add(sin(bankPhase).mul(r2.z)).toVar();
        const Wd = N.mul(cos(beta)).add(Bv.mul(sin(beta))).toVar();
        const Td = Bv.mul(cos(beta)).sub(N.mul(sin(beta))).toVar();
        // (Closed round the card it has no tips: its two ends have met.)
        const taper = mix(pow(max(sin(s.mul(Math.PI)), 0.0), float(0.55)), float(1.0), closed);
        const W = r1.x.mul(line.w).mul(taper).mul(sin(placed.mul(mix(9.0, TAU * 2, closed)).sub(r3.x)).mul(0.22).add(1.0)).toVar();
        // On the out-breath it parts into two soft streams and closes again, a stretch at a time:
        // each stream keeps its own full spread, so what opens is a valley of thinner light.
        const lobe = sign(fract(sr.mul(9.73)).sub(0.5));
        const split = r1.z.mul(float(1.0).sub(closed))
            .mul(pow(sin(s.mul(TAU * 0.75).sub(r3.x.mul(0.6))).mul(0.5).add(0.5), float(2.0)))
            .toVar();
        const xn = rho.mul(cos(a)).mul(float(1.0).sub(split.mul(0.4))).add(lobe.mul(split).mul(0.5)).toVar();
        const yn = rho.mul(sin(a)).mul(r1.y).toVar();
        // The sheet's folds: an S across it that travels down the flock. Turned edge on, each one
        // gathers the motes along a fine bright line.
        const fold = sin(xn.mul(2.5).add(placed.mul(mix(11.0, TAU * 2, closed))).sub(r3.x.mul(1.1))).mul(r1.w).toVar();

        // ── A touch: a pulse of light runs both ways along the flock from where it was touched ──
        const age = r5.x.toVar();
        const off = abs(s.sub(r5.y)).sub(age.mul(0.45)).mul(14.0).toVar();
        const pulse = exp(off.mul(off).negate()).mul(exp(age.mul(-0.9))).mul(r5.z)
            .mul(select(age.greaterThanEqual(0.0), float(1.0), float(0.0)))
            .toVar();
        const body = C.add(Wd.mul(xn.mul(W).mul(pulse.mul(0.25).add(1.0)))).add(Td.mul(yn.add(fold).mul(W))).toVar();

        // ── The gathering: the flock pours into a ring round the title, head first ──
        const g = smoothstep(s.mul(0.5), s.mul(0.5).add(0.5), r0.y).toVar();
        const theta = rank.mul(TAU).add(r3.z).toVar();
        // A living ring: its outline barely breathes, its body is thick with motes, not a drawn line.
        const ripple = float(1.0).add(sin(theta.mul(2.0).add(r3.z.mul(1.3))).mul(0.012))
            .add(sin(theta.mul(5.0).sub(r3.z.mul(2.1))).mul(0.007))
            .toVar();
        const tube = r3.w.mul(rho).mul(sin(theta.mul(3.0).add(r3.z.mul(0.7))).mul(0.14).add(1.0)).toVar();
        const ringP = vec3(
            r4.x.add(r4.z.mul(ripple).add(tube.mul(cos(a))).mul(cos(theta))),
            r4.y.add(r4.w.mul(ripple).add(tube.mul(cos(a))).mul(sin(theta))),
            r0.x.add(tube.mul(sin(a))),
        );
        const flown = mix(body, ringP, g).toVar();

        // ── The thread: a share of the motes runs from the current row into the stage card ──
        const threadMix = step(fract(sr.mul(17.37)), THREAD_SHARE).mul(L.element(int(0)).w).toVar();
        const tu = fract(seed.x.mul(53.0).add(L.element(int(2)).w.mul(fract(sr.mul(5.13)).mul(0.6).add(0.7)))).toVar();
        const tv = float(1.0).sub(tu).toVar();
        const threadAt = L.element(int(0)).xyz.mul(tv.mul(tv).mul(tv))
            .add(L.element(int(1)).xyz.mul(tv.mul(tv).mul(tu).mul(3.0)))
            .add(L.element(int(2)).xyz.mul(tv.mul(tu).mul(tu).mul(3.0)))
            .add(L.element(int(3)).xyz.mul(tu.mul(tu).mul(tu)))
            .toVar();
        // Pinched at the row and at the card, a strand that sways between them.
        const strand = sin(tu.mul(Math.PI)).toVar();
        const sway = rho.mul(cos(a)).add(sin(tu.mul(7.0).sub(u.time.mul(0.9))).mul(0.6));
        const threadP = threadAt.add(vec3(0.0, sway.mul(strand).mul(L.element(int(1)).w), rho.mul(sin(a)).mul(strand).mul(0.4)));
        const world = mix(flown, threadP, threadMix).toVar();

        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0)).toVar();
        const w = max(clip.w, 1e-4).toVar();

        // ── The interface: a mote flows round a panel, sliding along its edge ──
        const screen = vec2(clip.x.div(w).mul(0.5).add(0.5).mul(aspect), float(0.5).sub(clip.y.div(w).mul(0.5))).toVar();
        const shift = vec2(0.0).toVar();
        const presence = float(1.0).toVar();
        Loop({
            start: int(0), end: rectCount, type: 'int', condition: '<', name: 'zone',
        }, ({ zone }) => {
            const box = boxNode.element(zone).toVar(); // centre, half size (frame heights)
            const law = lawNode.element(zone).toVar(); // corner radius, reach, fade from, fade to
            const rel = screen.sub(box.xy).toVar();
            const q = abs(rel).sub(box.zw).add(law.x).toVar();
            const out = max(q, vec2(0.0)).toVar();
            const outside = length(out).toVar();
            const d = outside.add(min(max(q.x, q.y), 0.0)).sub(law.x).toVar();
            const across = select(q.x.greaterThan(q.y), vec2(1.0, 0.0), vec2(0.0, 1.0));
            const way = select(outside.greaterThan(1e-5), out.div(max(outside, 1e-5)), across).mul(sign(rel)).toVar();
            // A soft wall: past `reach` it does nothing; nearer, the distance eases to a quarter
            // of the reach and stays there, however far behind the panel the mote would be.
            const reach = law.y.toVar();
            const eased = reach.mul(exp(min(d.sub(reach), 0.0).div(reach.mul(0.75).add(1e-5))).mul(0.75).add(0.25));
            shift.addAssign(way.mul(max(eased.sub(d), 0.0)).mul(step(1e-5, reach)));
            presence.assign(min(presence, smoothstep(law.z, law.w, d)));
        });
        const free = float(1.0).sub(threadMix).toVar();
        const lift = shift.mul(free).toVar();
        const shown = mix(presence, float(1.0), threadMix).toVar();

        // ── Light: the banking bands, the pulse, the ends fading, a twinkle of its own ──
        // (In the ring the bands soften into a slow gleam running round it.)
        const gleam = cos(theta.sub(r3.z).mul(2.0).sub(r2.y.mul(0.4)));
        const band = mix(cos(bankPhase).mul(0.5), gleam.mul(0.16), g).add(1.0);
        const ends = mix(smoothstep(0.0, 0.1, s).mul(float(1.0).sub(smoothstep(0.82, 1.0, s))), float(1.0), closed);
        const twinkle = sin(u.time.mul(fract(sr.mul(7.3)).mul(2.2).add(0.7)).add(sr.mul(91.0))).mul(0.2).add(0.88);
        // Most motes are fine dust, a few are sparks, and a sprinkling are wide and faint: the
        // body of light that the rest stand on.
        const kind = fract(sr.mul(37.31)).toVar();
        const glow = step(0.997, kind).toVar();
        const spark = pow(sr, float(4.0)).toVar();
        // (Gathered, the same motes stand far closer together: each carries less, or the ring
        // burns white and its glow turns the whole sky to milk.)
        const grade = mix(float(0.62).add(spark.mul(2.2)), float(0.014), glow).mul(mix(float(1.0), float(0.5).sub(glow.mul(0.3)), g)).toVar();
        const nearness = clamp(float(46.0).div(w), 0.7, 1.35).toVar();
        const thread = smoothstep(0.0, 0.14, tu).mul(strand.mul(0.8).add(0.5)).add(0.15).toVar();
        const lit = r3.y.mul(mix(band.mul(mix(ends, float(1.0), g)), thread, threadMix))
            .mul(twinkle).mul(pulse.mul(2.6).add(1.0))
            .mul(shown)
            .mul(grade)
            .mul(nearness)
            .mul(gain);
        // The logo's spectrum along the flock: lavender at its head, aqua through its body, mint
        // at its tail, with cream in its brightest motes and in the ring.
        const lavender = vec3(0.47, 0.37, 1.0);
        const aqua = vec3(0.34, 0.81, 0.85);
        const mint = vec3(0.56, 0.88, 0.62);
        // Gathered, the colour runs round the ring and meets itself (head and tail are neighbours).
        const hueAt = mix(s, float(0.5).sub(cos(s.mul(TAU)).mul(0.5)), max(g, closed));
        const along = mix(mix(lavender, aqua, smoothstep(0.0, 0.5, hueAt)), mint, smoothstep(0.5, 1.0, hueAt));
        // Behind the menu the current mode lends the flock its light, as it lends the page.
        const lent = mix(along, hue.rgb, clamp(max(hue.w, threadMix), 0.0, 1.0));
        const tint = mix(lent, vec3(1.0, 0.92, 0.82), clamp(spark.mul(0.5).add(g.mul(0.12)), 0.0, 1.0));
        vLight.assign(tint.mul(lit));

        const scale = viewHeight.div(1080.0);
        const fine = float(1.7).add(spark.mul(2.0));
        const px = mix(fine, float(70.0).add(fract(sr.mul(3.1)).mul(50.0)), glow).mul(max(scale, 0.6)).mul(nearness);
        const size = px.div(viewHeight).mul(2.0);
        const offset = positionGeometry.xy.mul(vec2(size.div(aspect), size));
        const lifted = vec2(lift.x.mul(2.0).div(aspect), lift.y.mul(-2.0));
        return vec4(clip.xy.add(offset.add(lifted).mul(clip.w)), clip.z, clip.w);
    })();

    material.outputNode = Fn(() => {
        const r = length(uv().sub(0.5)).mul(2.0);
        const point = exp(r.mul(r).mul(-5.5)).mul(float(1.0).sub(smoothstep(0.82, 1.0, r)));
        return vec4(max(vLight.mul(point), vec3(0.0)), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'FirstLightMurmuration';
    mesh.frustumCulled = false;
    mesh.renderOrder = 60;

    return {
        mesh,
        material,
        count,
        /** The frame's state (see intro-world-core.js `murmurationAt`). */
        write(m, ringDepth) {
            // Its tips open only as the last of the gap closes (sooner they would be cut off blunt).
            rows[0].set(ringDepth, m.gather, easeBetween(0.82, 1, m.close), 0);
            rows[1].set(m.width, m.thick, m.split, m.fold);
            rows[2].set(m.bank[0], m.bank[1], m.bank[2], m.bank[3]);
            rows[3].set(m.bulge, m.light, m.swirl, m.ringTube);
            rows[4].set(m.ring[0], m.ring[1], m.ring[2], m.ring[3]);
            rows[5].set(m.pulse ?? -1, m.pulseAt ?? 0, m.pulseAmp ?? 0, 0);
        },
        /** The flock's line: FLOCK_POINTS rows of (x, y, z, width share). */
        writeLine(line) {
            for (let i = 0; i < FLOCK_POINTS; i++) {
                points[i].set(line[i * 4], line[i * 4 + 1], line[i * 4 + 2], line[i * 4 + 3]);
            }
        },
        /** The lent hue along the line: FLOCK_POINTS rows of (r, g, b, amount). */
        writeHues(tints) {
            for (let i = 0; i < FLOCK_POINTS; i++) {
                hues[i].set(tints[i * 4], tints[i * 4 + 1], tints[i * 4 + 2], tints[i * 4 + 3]);
            }
        },
        /**
         * The thread: a cubic Bézier (four world points), how far it has formed (0..1), its half
         * width in world units and the clock that runs it.
         */
        writeThread({
            points: b, amount, width, flow,
        }) {
            threadRows[0].set(b[0], b[1], b[2], amount);
            threadRows[1].set(b[3], b[4], b[5], width);
            threadRows[2].set(b[6], b[7], b[8], flow);
            threadRows[3].set(b[9], b[10], b[11], 0);
        },
        /**
         * The panels the motes flow round, at most RECT_SLOTS: { cx, cy, hx, hy } in frame heights
         * (x times the aspect, y down), and `radius`, `reach` (0 pushes nothing), `fadeFrom` and
         * `fadeTo` (distances from its edge), the same units.
         */
        setRects(list) {
            const n = Math.min(RECT_SLOTS, list.length);
            for (let i = 0; i < n; i++) {
                const r = list[i];
                rectBox[i].set(r.cx, r.cy, r.hx, r.hy);
                rectLaw[i].set(r.radius ?? 0, r.reach ?? 0, r.fadeFrom ?? 0, r.fadeTo ?? 0.05);
            }
            rectCount.value = n;
        },
        setViewport(height, viewAspect) {
            viewHeight.value = Math.max(1, height);
            aspect.value = Math.max(0.1, viewAspect);
        },
        setGain(value) {
            gain.value = value;
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            quad.dispose();
            material.dispose();
        },
    };
}

/**
 * Kaleidosonic — the temple: ONE full-screen material that marches every view ray through the
 * Apollonian field and shades what it meets.
 *
 * The lens first folds the ray through the kaleidoscope's mirrors (a chain opens them), then the
 * march walks the field in the temple's own coordinates (the dive offsets them, so the stone
 * flows past the eye while the core and every strike stay put). What it shades:
 *
 *   jewels    Indra's net: the core's image hangs in the same place in every cell of the
 *             lattice, so the halls recede through glowing jewels, each lighting its own hall and
 *             twinkling on its own phase; a short walk through the cells the ray crosses draws
 *             them (hidden behind stone)
 *   pearl     dark jewel-toned stone, two poles chosen by the orbit trap, lit by the nearest
 *             jewel and by the core (point lights with a wide wrap and a glint), filled faintly
 *             by the air, occluded by the march's own step count and one tap along the normal
 *   veins     the nodal shells of the nearest source's standing wave cut by the stone: rings
 *             round every jewel and round the core, flowing outward with the breath, broken
 *             into petals by a 3D quasicrystal field (six plane waves on the icosahedron's axes)
 *   mandala   on the floors, the core's own Faraday pattern: twelve-fold, centred under it
 *   strikes   each lock's wavefront: a band of the piece's light where the shell crosses the
 *             stone, ripples at the note's wavelength behind it, a faint shell in the air
 *   harmonic  each clear's spherical standing wave about the core: nodal shells cut the stone in
 *             concentric lines, as many as the clear's lines ask
 *   core      the hero: a white-hot heart, a twelve-petal corona that turns with the pulse, and
 *             sound rings running out of it
 *   air       fog toward the mood's haze
 *
 * Every pixel is opaque (alpha 1); the post tone-maps once.
 */
import * as THREE from 'three/webgpu';
import {
    Break, Fn, If, Loop, abs, atan, clamp, cos, dot, exp, float, floor, fwidth, int, length, max, min, mix,
    normalize, positionGeometry, sign, sin, smoothstep, sqrt, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {
    HARMONIC_ROWS, MOOD_COLOURS, STRIKE_ROWS, TAU, TEMPLE, createTempleField, ksHash31, ksLensFold, moodColour,
} from './kaleidosonic-tsl.js';

/** The six axes of the icosahedron (unit): the petals' plane waves. */
const PHI = (1 + Math.sqrt(5)) / 2;
const ICOSA = [[0, 1, PHI], [0, 1, -PHI], [1, PHI, 0], [1, -PHI, 0], [PHI, 0, 1], [-PHI, 0, 1]]
    .map((a) => {
        const l = Math.hypot(a[0], a[1], a[2]);
        return [a[0] / l, a[1] / l, a[2] / l];
    });
/** A source's standing wave: radians per unit of distance (nodal shells every π / RING_K). */
const RING_K = 26;
/** The floor mandala's wavenumber and its reach (1/e radius, units). */
const MANDALA_K = 22;
const MANDALA_REACH = 1.1;
/** The march's far limit: the fog has taken everything by then. */
const FAR = 10;
const P = TEMPLE.period;
/** Cells of the lattice a ray's jewel walk visits. */
const JEWEL_CELLS = 10;

/**
 * @param {object} u uniforms from createUniforms()
 * @param {object} tier the quality tier (steps, folds, shadowSteps)
 */
export function createTemple(u, tier) {
    const field = createTempleField(tier.folds);
    const steps = Math.max(16, Math.round(tier.steps));
    const shadowSteps = Math.max(0, Math.round(tier.shadowSteps || 0));
    const jewelCells = Math.max(3, Math.round(tier.jewelCells ?? JEWEL_CELLS));
    const veinTier = Math.max(0.2, Math.min(1, tier.veins ?? 1));

    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    material.name = 'Kaleidosonic — temple';
    material.fog = false;
    const vNdc = varying(positionGeometry.xy);
    material.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);

    const prm = () => vec4(u.shape.x, u.shape.y, 0.0, 0.0);
    const at = (p) => field(p.add(u.dive), prm());

    material.fragmentNode = Fn(() => {
        const mk = u.moodMix;
        const stoneA = moodColour(u, 'stoneA', mk).toVar();
        const stoneB = moodColour(u, 'stoneB', mk).toVar();
        // the moods' three neon colours, mood A and mood B (the shader stages the change by region)
        const row = (key, second) => {
            const index = MOOD_COLOURS.indexOf(key) + (second ? MOOD_COLOURS.length : 0);
            return u.moods.element(int(index)).xyz;
        };
        const neonA1 = row('neonA', false).toVar();
        const neonB1 = row('neonB', false).toVar();
        const neonC1 = row('neonC', false).toVar();
        const neonA2 = row('neonA', true).toVar();
        const neonB2 = row('neonB', true).toVar();
        const neonC2 = row('neonC', true).toVar();
        const heartCol = moodColour(u, 'heart', mk).toVar();
        const haze = moodColour(u, 'haze', mk).toVar();
        const glowCol = moodColour(u, 'glow', mk).toVar();
        const trance = u.state.x.toVar();
        const resonance = u.state.y.toVar();
        const mandala = u.state.z.toVar();
        const sink = u.heartState.z.toVar();
        const lightK = u.heartState.x.mul(float(1).sub(sink.mul(0.6))).toVar();
        // the core itself also takes the events' flare (the stone does not: a lock must not pulse the frame)
        const coreK = u.heartState.x.add(u.heartState.w.mul(1.6)).mul(float(1).sub(sink.mul(0.6))).toVar();
        const { breath } = u;

        // ── the ray, folded through the kaleidoscope ──
        const vh = u.projInv.mul(vec4(vNdc, 1.0, 1.0));
        const lensed = ksLensFold(normalize(vh.xyz.div(vh.w)), u.lens, u.lensS).toVar();
        const rd = normalize(u.camWorld.mul(vec4(lensed.xyz, 0.0)).xyz).toVar();
        // the kaleidoscope's alternate sectors light their jewels in the mood's other colour
        const other = lensed.w;
        const neonNow = mix(neonA1, neonA2, mk);
        const jewelCol = mix(heartCol, neonNow.mul(1.6), other.mul(0.85)).toVar();
        const ro = u.camWorld.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz.toVar();

        // ── the march ──
        const t = float(0.02).toVar();
        const hit = float(0).toVar();
        const res = vec4(0).toVar();
        const used = float(0).toVar();
        Loop(steps, () => {
            const h = at(ro.add(rd.mul(t))).toVar();
            If(h.x.lessThan(t.mul(u.pixelAngle).mul(1.1).add(1e-5)), () => {
                hit.assign(1);
                res.assign(h);
                Break();
            });
            t.addAssign(h.x.mul(0.9));
            used.addAssign(1);
            If(t.greaterThan(FAR), () => {
                Break();
            });
        });
        const tEnd = mix(float(FAR), t, hit).toVar();

        // The core (camera-fixed) and the jewels (fixed in the temple: the core's place at rest,
        // repeated in every cell; in the eye's frame they flow with the dive).
        const heartPos = u.heart.xyz.toVar();
        const jewelBase = heartPos.sub(u.dive).toVar();
        const col = vec3(0).toVar();
        const fogK = u.air.x;
        // far air is lit by the countless jewels beyond sight: a faint glow in the haze
        const airGlow = haze.mul(1.3).add(glowCol.mul(0.02)).mul(float(1).sub(sink.mul(0.55))).toVar();
        If(hit.greaterThan(0.5), () => {
            const p = ro.add(rd.mul(t)).toVar();
            const e = max(t.mul(u.pixelAngle).mul(0.6), 2e-5);
            const k = vec2(1, -1);
            const n = normalize(
                k.xyy.mul(at(p.add(k.xyy.mul(e))).x)
                    .add(k.yyx.mul(at(p.add(k.yyx.mul(e))).x))
                    .add(k.yxy.mul(at(p.add(k.yxy.mul(e))).x))
                    .add(k.xxx.mul(at(p.add(k.xxx.mul(e))).x)),
            ).toVar();
            const occ = float(1).sub(used.div(steps)).toVar();
            const tap = at(p.add(n.mul(0.04))).x;
            const ao = clamp(tap.div(0.04), 0.0, 1.0).mul(occ).mul(occ).toVar();

            // pearl: two poles by the trap's bands (wide ramps, never stripes)
            const band = res.w.mul(0.7).add(res.y.mul(1.3));
            const pole = smoothstep(0.2, 0.8, abs(band.sub(floor(band)).mul(2.0).sub(1.0)));
            const albedo = mix(stoneA, stoneB, pole).toVar();
            // the stone's neon: one of the mood's three colours per region of the orbit trap, the
            // next mood's colours arriving region by region (never a straight mix of complements)
            const bandN = res.w.mul(0.83).add(res.z.mul(1.71)).add(res.y.mul(0.37)).fract();
            const m1 = smoothstep(0.28, 0.38, bandN);
            const m2 = smoothstep(0.61, 0.71, bandN);
            const neon1 = mix(mix(neonA1, neonB1, m1), neonC1, m2);
            const neon2 = mix(mix(neonA2, neonB2, m1), neonC2, m2);
            const when = res.w.mul(0.37).add(res.y.mul(0.61)).fract().mul(0.7);
            const neon = mix(neon1, neon2, smoothstep(when, when.add(0.3), mk)).toVar();

            // the core's light
            const toH = heartPos.sub(p).toVar();
            const dH = length(toH).toVar();
            const L = toH.div(max(dH, 1e-4)).toVar();
            const fall = float(1.3).div(dH.mul(dH).mul(9.0).add(1.0)).toVar();
            const lit = clamp(dot(n, L).mul(0.75).add(0.25), 0.0, 1.0).mul(fall).toVar();
            if (shadowSteps > 0) {
                // a short soft shadow toward the core (Ultra and up)
                const sh = float(1).toVar();
                const st = float(0.03).toVar();
                Loop(shadowSteps, () => {
                    const hs = at(p.add(L.mul(st))).x;
                    sh.assign(min(sh, hs.mul(9.0).div(st)));
                    st.addAssign(max(hs, 0.02));
                    If(st.greaterThan(dH).or(sh.lessThan(0.02)), () => {
                        Break();
                    });
                });
                lit.mulAssign(clamp(sh, 0.0, 1.0).mul(0.75).add(0.25));
            }
            // the nearest jewel's light (it gives way where it stands on the core itself)
            const cellJ = floor(p.sub(jewelBase).div(P).add(0.5)).toVar();
            const J = jewelBase.add(cellJ.mul(P)).toVar();
            const toJ = J.sub(p).toVar();
            const dJ = length(toJ).toVar();
            const LJ = toJ.div(max(dJ, 1e-4));
            const away = smoothstep(0.04, 0.4, length(J.sub(heartPos)));
            const twinkle = sin(u.pulse.mul(0.7).add(ksHash31(cellJ.add(17.0)).mul(TAU))).mul(0.25).add(0.75);
            const fallJ = float(2.2).div(dJ.mul(dJ).mul(3.0).add(1.0)).mul(away).mul(twinkle)
                .toVar();
            const litJ = clamp(dot(n, LJ).mul(0.75).add(0.25), 0.0, 1.0).mul(fallJ);

            const hv = normalize(L.sub(rd));
            const g = clamp(dot(n, hv), 0.0, 1.0);
            const g2 = g.mul(g);
            const g8 = g2.mul(g2).mul(g2).mul(g2);
            const glint = g8.mul(g8).mul(g8).mul(fall.add(fallJ)).mul(1.6);
            const f1 = clamp(float(1).add(dot(n, rd)), 0.0, 1.0);
            const rim = f1.mul(f1).mul(f1);
            const sky = haze.mul(n.y.mul(0.35).add(0.65));
            col.assign(albedo.mul(heartCol.mul(lit.add(litJ).mul(lightK)).add(sky.mul(0.8))).mul(ao));
            col.addAssign(heartCol.mul(glint).mul(ao).mul(lightK));
            // fluorescence: as under black light, the pearl's turning edges glow in their own neon
            col.addAssign(neon.mul(rim.mul(0.3).mul(fall.add(fallJ).mul(0.8).add(0.3))).mul(ao.mul(0.6).add(0.4)));
            // nacre: a soft sheen in the mood's glow
            col.addAssign(glowCol.mul(f1.mul(f1).mul(0.05)).mul(ao.mul(0.6).add(0.4)));

            // ── veins: a mandala of standing waves round every jewel, cut by the stone ──
            // Rings: the nodal shells of the nearest source's sound, flowing outward with the
            // breath (inward as the light sinks). Petals: twelve round the source's vertical axis.
            const srcIsCore = dH.lessThan(dJ);
            const src = mix(J, heartPos, float(srcIsCore)).toVar();
            const dSrc = min(dH, dJ).toVar();
            const vs = p.sub(src);
            const petals = cos(atan(vs.z, vs.x.add(1e-7)).mul(12.0).add(breath.mul(0.5)));
            const petal = smoothstep(-0.35, 0.65, petals);
            const wr = cos(dSrc.mul(RING_K).sub(breath.mul(2.0))).toVar();
            const aa = max(fwidth(wr), 0.02).toVar();
            // where the rings crowd under a pixel they fade instead of tangling
            const legible = float(1).sub(smoothstep(0.35, 1.1, aa));
            const vein = exp(abs(wr).div(aa).mul(-1.8)).mul(petal.mul(0.55).add(0.45)).mul(legible).toVar();
            const droneRings = exp(dH.mul(-2.5)).mul(u.heartState.y).mul(sin(u.pulse.mul(2.0)).mul(0.3).add(0.9));
            const veinGain = float(0.3).add(fall.mul(3.2)).add(fallJ.mul(2.0)).add(resonance.mul(1.2))
                .add(trance.mul(0.7))
                .add(droneRings.mul(2.5))
                .mul(float(1).sub(sink.mul(0.85)))
                .toVar();

            // ── on the floors and vaults: each source's Chladni figure ──
            // A circular plate's mode under the nearest jewel (or the core): nodal circles crossed
            // by twelve nodal diameters, turning slowly with the breath.
            const fy = abs(p.y.sub(floor(p.y.mul(0.5).add(0.5)).mul(2.0)));
            const onFloor = float(1).sub(smoothstep(0.004, 0.03, fy)).mul(smoothstep(0.86, 0.98, abs(n.y)));
            const fc = p.xz.sub(src.xz).toVar();
            const fr = length(fc).toVar();
            const circles = cos(fr.mul(MANDALA_K).sub(breath.mul(1.5)));
            const diameters = cos(atan(fc.y, fc.x.add(1e-7)).mul(6.0).add(breath.mul(0.15)));
            const wm = circles.mul(diameters).toVar();
            const aaM = max(fwidth(wm), 0.015);
            const mandalaLine = exp(abs(wm).div(aaM).mul(-1.4)).mul(float(1).sub(smoothstep(0.35, 1.1, aaM)))
                .mul(exp(fr.div(-MANDALA_REACH))).mul(float(1.1).add(mandala.mul(2.0)));
            vein.assign(mix(vein, mandalaLine.add(vein.mul(0.25)), onFloor));
            veinGain.assign(mix(veinGain, veinGain.add(0.25), onFloor));
            col.addAssign(neon.mul(vein).mul(veinGain).mul(ao.mul(0.55).add(0.45)).mul(veinTier));

            // ── strikes: each lock's wavefront crossing the stone (their light gathered, then
            // capped softly: many at once must not wash the frame white) ──
            const evCol = vec3(0).toVar();
            Loop({
                start: int(0), end: int(u.counts.x), type: 'int', condition: '<', name: 'sk',
            }, ({ sk }) => {
                const A = u.strikes.element(sk.mul(STRIKE_ROWS));
                const B = u.strikes.element(sk.mul(STRIKE_ROWS).add(1));
                const C = u.strikes.element(sk.mul(STRIKE_ROWS).add(2));
                const age = A.w;
                const r = age.mul(C.y);
                const dist = length(p.sub(A.xyz));
                const x = dist.sub(r);
                const width = float(0.035).add(C.z.mul(0.025));
                const front = exp(x.div(width).mul(x.div(width)).negate());
                // the note rings on where the front has passed: concentric ripples at its own
                // wavelength round the struck point, breathing outward and dying away (its cymatic
                // signature, longer than the front)
                const behind = smoothstep(0.0, 0.03, x.negate());
                const ripple = sin(dist.div(C.x).sub(age.mul(3.0)).mul(TAU)).mul(0.5).add(0.5);
                const r3 = ripple.mul(ripple).mul(ripple);
                const rings = r3.mul(exp(dist.mul(-3.0))).mul(exp(age.mul(-0.8))).mul(behind).mul(B.w);
                const fade = exp(age.mul(-1.05)).mul(B.w);
                const near = float(1).div(dist.mul(dist).mul(1.5).add(1.0));
                const light = front.mul(2.4).add(vein.mul(front).mul(3.0)).mul(fade).mul(near.mul(0.7).add(0.3))
                    .add(rings.mul(1.6));
                evCol.addAssign(B.xyz.mul(light).mul(ao.mul(0.5).add(0.5)));
                // the struck point floods the stone round it with the piece's light for an instant
                const toS = A.xyz.sub(p);
                const ds2 = max(dot(toS, toS), 1e-6);
                const Ls = toS.div(sqrt(ds2));
                const fallS = float(1).div(ds2.mul(10.0).add(0.25));
                const flood = clamp(dot(n, Ls).mul(0.75).add(0.25), 0.0, 1.0).mul(fallS).mul(exp(age.mul(-3.0)))
                    .mul(B.w);
                const takes = albedo.mul(8.0).add(rim.mul(0.5)).add(0.02);
                evCol.addAssign(B.xyz.mul(flood).mul(takes).mul(ao.mul(0.6).add(0.4)));
            });

            // ── harmonics: a clear's spherical standing wave about the core ──
            Loop({
                start: int(0), end: int(u.counts.y), type: 'int', condition: '<', name: 'hm',
            }, ({ hm }) => {
                const H0 = u.harmonics.element(hm.mul(HARMONIC_ROWS));
                const H1 = u.harmonics.element(hm.mul(HARMONIC_ROWS).add(1));
                const reach = H0.x;
                const mode = H0.z;
                const strength = H0.w;
                const inside = smoothstep(reach, reach.sub(0.35), dH);
                const phase = dH.mul(mode.mul(5.5).add(4.0)).sub(H0.y.mul(2.0));
                const node = abs(cos(phase.mul(Math.PI)));
                const shell = exp(node.div(max(fwidth(phase).mul(Math.PI), 0.03)).mul(-1.0));
                // the chord's front crosses every hall's stone, lighting its veins as it passes
                const xf = dH.sub(reach).div(0.06);
                const front = exp(xf.mul(xf).negate());
                const wave = shell.mul(inside).add(vein.mul(inside).mul(0.6)).add(front.mul(vein.mul(3.0).add(0.6)));
                evCol.addAssign(H1.xyz.mul(wave).mul(strength).mul(ao.mul(0.5).add(0.5)));
            });

            // fog thickens with distance (the first half unit is clear)
            const evPeak = max(evCol.x, max(evCol.y, evCol.z));
            col.addAssign(evCol.div(evPeak.mul(0.35).add(1.0)));
            col.assign(mix(col, airGlow, float(1).sub(exp(max(t.sub(0.5), 0.0).mul(fogK).negate()))));
        }).Else(() => {
            col.assign(airGlow);
        });

        // ── the jewels the ray passes on its way (a walk through the lattice's cells) ──
        const g0 = ro.sub(jewelBase).div(P).add(0.5).toVar();
        const cell = floor(g0).toVar();
        const stepDir = sign(rd).toVar();
        const inv = vec3(1.0).div(max(abs(rd), vec3(1e-4))).toVar();
        const tDelta = inv.mul(P).toVar();
        const firstEdge = cell.add(max(stepDir, vec3(0.0))).sub(g0).mul(stepDir).toVar();
        const tMax = firstEdge.mul(tDelta).toVar();
        const jewels = vec3(0).toVar();
        Loop(jewelCells, () => {
            const image = jewelBase.add(cell.mul(P));
            const oc = image.sub(ro);
            const tc = dot(oc, rd);
            const d2 = max(dot(oc, oc).sub(tc.mul(tc)), 0.0);
            const onCore = smoothstep(0.02, 0.12, length(image.sub(heartPos)));
            const seen = smoothstep(0.0, 0.04, tEnd.sub(tc)).mul(smoothstep(0.0, 0.04, tc)).mul(onCore);
            const tw = sin(u.pulse.mul(0.7).add(ksHash31(cell.add(17.0)).mul(TAU))).mul(0.25).add(0.75);
            const glow = exp(d2.div(0.0012).negate()).mul(3.2).add(exp(sqrt(d2).mul(-11.0)).mul(0.3));
            // sympathetic resonance: a passing wavefront rings the jewel in its own colour
            const xs = length(image.sub(u.pingStrike.xyz)).sub(u.pingStrike.w).div(0.14);
            const ringS = exp(xs.mul(xs).negate()).mul(u.pingStrikeCol.w);
            const xh = length(image.sub(heartPos)).sub(u.pingHarm.x).div(0.16);
            const ringH = exp(xh.mul(xh).negate()).mul(u.pingHarm.y);
            const tint = jewelCol.add(u.pingStrikeCol.xyz.mul(ringS.mul(5.0)))
                .add(u.pingHarmCol.xyz.mul(ringH.mul(4.0)));
            jewels.addAssign(tint.mul(glow.mul(seen).mul(tw).mul(exp(tc.mul(fogK).mul(-0.85)))));
            // the next cell: across whichever wall the ray reaches first
            If(tMax.x.lessThan(tMax.y).and(tMax.x.lessThan(tMax.z)), () => {
                cell.x.addAssign(stepDir.x);
                tMax.x.addAssign(tDelta.x);
            }).ElseIf(tMax.y.lessThan(tMax.z), () => {
                cell.y.addAssign(stepDir.y);
                tMax.y.addAssign(tDelta.y);
            }).Else(() => {
                cell.z.addAssign(stepDir.z);
                tMax.z.addAssign(tDelta.z);
            });
        });
        col.addAssign(jewels.mul(lightK.mul(0.55)));

        // ── the air: the strikes' shells, faintly, where the ray passes through them ──
        Loop({
            start: int(0), end: int(u.counts.x), type: 'int', condition: '<', name: 'sa',
        }, ({ sa }) => {
            const A = u.strikes.element(sa.mul(STRIKE_ROWS));
            const B = u.strikes.element(sa.mul(STRIKE_ROWS).add(1));
            const C = u.strikes.element(sa.mul(STRIKE_ROWS).add(2));
            const r = A.w.mul(C.y);
            const oc = A.xyz.sub(ro);
            const tc = dot(oc, rd);
            const dc2 = max(dot(oc, oc).sub(tc.mul(tc)), 0.0);
            const inside = r.mul(r).sub(dc2);
            const reach = sqrt(max(inside, 0.0));
            // the near crossing of the shell, if the ray meets it at all and before the stone
            const tn = tc.sub(reach);
            const seen = smoothstep(0.0, 0.05, tEnd.sub(tn)).mul(smoothstep(0.0, 0.05, tn))
                .mul(smoothstep(0.0, 0.0004, inside));
            // only the thinnest rim of the wavefront shows in the air, and only while it is young
            const graze = exp(reach.div(max(r, 0.05)).mul(-28.0));
            const fade = exp(A.w.mul(-2.6)).mul(B.w).mul(exp(r.mul(-2.0)));
            col.addAssign(B.xyz.mul(graze.mul(seen).mul(fade).mul(0.7)));
            // the struck point itself: a lotus of eight petals in the piece's colour that opens,
            // turns a little and closes (a new jewel born), round a white-hot first instant
            const age = A.w;
            const pc = ro.add(rd.mul(tc)).sub(A.xyz);
            const dS = sqrt(dc2);
            const right = u.camWorld.mul(vec4(1.0, 0.0, 0.0, 0.0)).xyz;
            const up = u.camWorld.mul(vec4(0.0, 1.0, 0.0, 0.0)).xyz;
            const bloomR = float(0.009).add(age.mul(0.03)).mul(C.z.mul(0.5).add(1.0));
            const xs = dS.div(bloomR);
            const ang = atan(dot(pc, up), dot(pc, right).add(1e-7));
            const lobe = cos(ang.mul(8.0).add(age.mul(2.5))).mul(0.5).add(0.5);
            const xr = xs.div(lobe.mul(1.1).add(0.7));
            const petals = exp(xr.mul(xr).negate()).mul(2.2);
            const bud = exp(xs.mul(xs).mul(-6.0)).mul(3.0);
            const lotus = petals.add(bud).mul(exp(age.mul(-3.4)));
            const whiteHot = exp(xs.mul(xs).mul(-9.0)).mul(exp(age.mul(-14.0))).mul(5.0);
            const sparkSeen = smoothstep(0.0, 0.03, tEnd.sub(tc)).mul(smoothstep(0.0, 0.03, tc));
            col.addAssign(B.xyz.mul(lotus).add(vec3(whiteHot)).mul(sparkSeen).mul(B.w));
        });

        // ── the clears' standing waves leave the core as shells of light in the air ──
        Loop({
            start: int(0), end: int(u.counts.y), type: 'int', condition: '<', name: 'ha',
        }, ({ ha }) => {
            const H0 = u.harmonics.element(ha.mul(HARMONIC_ROWS));
            const H1 = u.harmonics.element(ha.mul(HARMONIC_ROWS).add(1));
            const r = H0.x;
            const oc = heartPos.sub(ro);
            const tc = dot(oc, rd);
            const inside = r.mul(r).sub(max(dot(oc, oc).sub(tc.mul(tc)), 0.0));
            const reach = sqrt(max(inside, 0.0));
            const tn = tc.sub(reach);
            const seen = smoothstep(0.0, 0.05, tEnd.sub(tn)).mul(smoothstep(0.0, 0.05, tn))
                .mul(smoothstep(0.0, 0.0004, inside));
            const graze = exp(reach.div(max(r, 0.05)).mul(-24.0));
            col.addAssign(H1.xyz.mul(graze.mul(seen).mul(H0.w).mul(0.6)));
        });

        // ── the core: a white-hot heart, a turning corona of twelve petals, sound rings ──
        const toC = heartPos.sub(ro);
        const tcH = max(dot(toC, rd), 0.0);
        const off = ro.add(rd.mul(tcH)).sub(heartPos).toVar();
        const dcH = length(off).toVar();
        const visible = smoothstep(0.0, 0.03, tEnd.sub(tcH));
        const radius = u.heart.w;
        const camRight = u.camWorld.mul(vec4(1.0, 0.0, 0.0, 0.0)).xyz;
        const camUp = u.camWorld.mul(vec4(0.0, 1.0, 0.0, 0.0)).xyz;
        const theta = atan(dot(off, camUp), dot(off, camRight).add(1e-7));
        const x = dcH.div(radius).toVar();
        // a lotus of twelve lobes: the corona's reach swells and narrows round the gem
        const lobes = cos(theta.mul(12.0).add(u.pulse.mul(0.25))).mul(0.5).add(0.5);
        const reachC = lobes.mul(1.1).add(1.7);
        const xc = x.div(reachC);
        const corona = exp(xc.mul(xc).mul(-1.0)).mul(0.55).add(exp(xc.mul(-2.4)).mul(0.18));
        const soundRings = cos(x.mul(1.4).sub(u.pulse.mul(1.6))).mul(0.5).add(0.5);
        const rings = soundRings.mul(soundRings).mul(soundRings).mul(exp(x.mul(-0.5))).mul(0.25);
        const halo = exp(dcH.mul(-16.0)).mul(0.07);
        const drone = u.heartState.y;
        col.addAssign(jewelCol.mul(corona.add(rings).add(halo).add(drone.mul(halo).mul(2.0))).mul(visible).mul(coreK));

        // the gem itself: a sphere cut into twelve facets (the icosahedron's vertices), lit from
        // within in the core's colour and its neons, its facet edges sparkling white
        const gemR = radius.mul(1.35);
        const og = ro.sub(heartPos);
        const bq = dot(og, rd);
        const disc = bq.mul(bq).sub(dot(og, og).sub(gemR.mul(gemR)));
        const tg = bq.negate().sub(sqrt(max(disc, 0.0)));
        const onGem = smoothstep(0.0, gemR.mul(gemR).mul(0.02), disc).mul(smoothstep(0.0, 0.02, tEnd.sub(tg)))
            .mul(visible)
            .toVar();
        // a facet edge's width in the facets' own measure: one pixel turns the gem's normal by about
        // pixelAngle · distance / radius (worked out here, not by derivatives inside the branch)
        const edgeW = max(u.pixelAngle.mul(max(tg, 0.01)).div(gemR).mul(1.2), 1e-4).toVar();
        If(onGem.greaterThan(0.001), () => {
            const ns = normalize(ro.add(rd.mul(tg)).sub(heartPos)).toVar();
            const best = float(-1).toVar();
            const second = float(-1).toVar();
            const facetN = vec3(0, 1, 0).toVar();
            const facetK = float(0).toVar();
            ICOSA.forEach((a, j) => {
                const d = dot(ns, vec3(a[0], a[1], a[2]));
                const ad = abs(d).toVar();
                If(ad.greaterThan(best), () => {
                    second.assign(best);
                    best.assign(ad);
                    facetN.assign(vec3(a[0], a[1], a[2]).mul(sign(d)));
                    facetK.assign(float(j).add(sign(d).mul(0.5).add(0.5).mul(6.0)));
                }).ElseIf(ad.greaterThan(second), () => {
                    second.assign(ad);
                });
            });
            // facet colours: the core's own and its neons, by facet
            const k3 = facetK.sub(floor(facetK.div(3.0)).mul(3.0));
            const facetA = mix(jewelCol, neonNow.mul(1.4), smoothstep(0.5, 1.5, k3));
            const facetCol = mix(facetA, mix(neonB1, neonB2, mk).mul(1.4), smoothstep(1.5, 2.5, k3));
            const face = clamp(dot(facetN, rd.negate()), 0.0, 1.0);
            // bright enough to glow, held under white so every facet keeps its colour
            const inner = float(0.32).add(face.mul(face).mul(0.55));
            const edge = exp(best.sub(second).div(edgeW).mul(-1.5));
            const glint = face.mul(face).mul(face).mul(face).mul(face)
                .mul(face)
                .mul(1.4);
            const gem = facetCol.mul(inner).add(vec3(1.0, 0.95, 1.0).mul(edge.mul(1.2).add(glint)));
            col.assign(mix(col, gem.mul(coreK), onGem));
        });
        // a four-line or perfect flash, coloured by the core
        col.addAssign(heartCol.mul(u.state.w.mul(0.08)));
        return vec4(max(col, vec3(0.0)).mul(u.exposure), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'KaleidosonicTemple';
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    return {
        mesh,
        material,
        geometry,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

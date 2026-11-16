/**
 * Voltage Storm — the sky.
 *
 * The whole sky (the clear twilight strip at the horizon, the far thunderheads, hills and rain
 * shafts standing in it, the supercell's vault and the scud racing under it) is painted once per
 * frame into a reduced-resolution target: the cloud is soft, so it does not need the screen's
 * pixels, and the flooded plain mirrors the same image (voltage-storm-water.js), so the mirror
 * costs one fetch.
 *
 * The cell is a slab walked along the view ray, front to back, and its underside is a VAULT: it
 * steps down in tiers from high overhead out to the cell's edge (`vaultBase` in the core), so the
 * storm stands in the frame as terraces one behind another instead of one ceiling smeared toward
 * the horizon. The lobes come from one baked 3D noise read (a second, finer one erodes their
 * edges), and the whole vault turns slowly about its centre. What makes it read as hanging masses
 * and not as fog is the light:
 *   - a lobe is lit by how LOW it hangs: its tip catches the strip's light, the recesses between
 *     lobes are nearly black;
 *   - and by what stands between it and the strip (one or two taps toward the horizon), so each
 *     lobe has a lit side, each tier a lit fringe, and the far cloud is the brightest;
 *   - every live lightning stroke is a light INSIDE the cloud: it is strongest deep in the slab
 *     and deepens in colour the more cloud it crosses, so the lobes in front of it stand dark
 *     against a glow that is white only at its heart;
 *   - the sheet lightning of a superbolt (and the slow front of a new level's light) is a ring
 *     that runs out through the slab;
 *   - a perfect clear opens an eye in the vault: the evening above pours down through it.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    atan,
    clamp,
    cos,
    dot,
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
    screenCoordinate,
    screenUV,
    sin,
    smoothstep,
    sqrt,
    step,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SKY_CODE_PEAK, STORM, vsHash11, vsHash21, vsPart, vsPassMaterial, vsTarget,
} from './voltage-storm-tsl.js';

/** Metres of full cloud that put out 63% of the light behind them. */
const EXTINCTION = 45;
/** How far toward the horizon's light the two shading taps reach (metres), and the way to it. */
const LIGHT_NEAR = 150;
const LIGHT_FAR = 480;
const LIGHT_WAY = Object.freeze([Math.sin(STORM.glowAzimuth) * 0.997, -0.07, -Math.cos(STORM.glowAzimuth) * 0.997]);
/** The band of the storm's edge (metres before `STORM.edge` where the cover thins out). */
const EDGE_BAND = 900;
/** The depth of the lobes' zone over a tier's base (metres): above it the cloud is solid and dark. */
const SPAN = STORM.cloudDepth + STORM.cloudSag;
const MARCH_TOP = 0.62;
/** The height (metres) a twist's funnel comes down to at its fullest: just over the hero tower's finial. */
const FUNNEL_TIP = 84;
/** A perfect clear's eye is a funnel: its radius grows this many metres for each metre above the base. */
const EYE_FLARE = 1.7;
/** Ground (metres) one march step may cover before a low ray gets more steps. */
const MARCH_GROUND = 40;

/**
 * @param {object} u  shared storm uniforms
 * @param {object} options
 * @param {number} options.march       steps through the slab
 * @param {boolean} options.detail     second noise read and the light taps
 * @param {boolean} options.flashSteps light every step with the strokes (else once per pixel)
 * @param {boolean} options.scud       the scud layer under the vault
 * @param {boolean} options.far        the far thunderheads in the strip
 * @param {boolean} options.curtains   the rain curtains between the lens and the far shore
 */
export function createSky(u, {
    march = 14, detail = true, flashSteps = true, scud = true, far = true, curtains = true,
} = {}) {
    // The vault is taller than one ceiling was: a ray may cross open air under a high tier before
    // it meets the next one's wall, and those steps cost nothing but arithmetic.
    const stepBudget = detail ? 3 : 2;

    /** The lowest tier's base (the whole underside lifts as the storm eases). */
    const yBot = float(STORM.cloudBase - STORM.cloudSag).add(u.storm.y);
    /**
     * The cloud's underside over a point of the plain: `{ base }` in metres and `{ wall }`, 1 just
     * beyond a tier's step (the inner wall of the lower tier) falling to 0 across it.
     */
    const vaultAt = (xz) => {
        const wobble = sin(xz.x.div(260.0).add(1.3)).mul(sin(xz.y.div(310.0).add(0.4)))
            .add(sin(xz.x.div(97.0).add(xz.y.div(131.0))).mul(0.5))
            .mul(STORM.tierWobble);
        const r = length(xz.sub(vec2(STORM.vaultCentre[0], STORM.vaultCentre[1]))).add(wobble);
        const s = clamp(r.div(STORM.tierRadius), 0.0, STORM.tiers);
        const whole = floor(s);
        const part = s.sub(whole);
        const stair = min(whole.add(smoothstep(STORM.tierRiser, 1.0, part)), STORM.tiers);
        const base = yBot.add(u.storm.z.mul(float(STORM.tiers).sub(stair)));
        const wall = float(1.0).sub(smoothstep(0.0, 0.3, part)).mul(step(0.5, whole));
        return { base, wall };
    };

    /**
     * The strokes' light INSIDE the cloud at a world point. It falls off faster there than in
     * clear air (the cloud swallows it), so a stroke lights the part of the vault it burns in,
     * bright at its heart and gone a few hundred metres out, and the rest of the storm stays dark
     * round it: a glow in the cloud, never a wash over the sky.
     */
    const cloudFlash = (point, name) => {
        const sum = vec3(0.0).toVar();
        Loop({
            start: int(0), end: int(u.flashCount), type: 'int', condition: '<', name,
        }, (loop) => {
            const index = loop[name];
            const at = u.flashes.element(index.mul(2));
            const light = u.flashes.element(index.mul(2).add(1));
            const away = point.sub(at.xyz);
            const fall = float(1.0).div(float(1.0).add(dot(away, away).div(at.w.mul(at.w))));
            sum.addAssign(light.xyz.mul(fall.mul(fall).mul(fall).mul(1.7)));
        });
        return sum;
    };

    /** A world point in the cloud's own turning, twisting ground plan. */
    const plan = (p) => {
        // The cell winds up over the hero tower on a twist: the noise domain turns with it.
        const rel = p.xz.sub(u.twist.xy);
        const turn = u.twist.z.mul(exp(dot(rel, rel).div(u.twist.w.mul(u.twist.w)).negate()));
        const c = cos(turn);
        const s = sin(turn);
        const twisted = vec2(rel.x.mul(c).sub(rel.y.mul(s)), rel.x.mul(s).add(rel.y.mul(c))).add(u.twist.xy);
        // And the whole vault turns about its centre (the world hands over the cosine and sine).
        const centre = vec2(STORM.vaultCentre[0], STORM.vaultCentre[1]);
        const out = twisted.sub(centre);
        return vec2(
            out.x.mul(u.vault.x).sub(out.y.mul(u.vault.y)),
            out.x.mul(u.vault.y).add(out.y.mul(u.vault.x)),
        ).add(centre).add(u.drift.xz);
    };
    /** Where in the 3D noise a world point reads (`w` = its place in the cloud's ground plan). */
    const noisePoint = (p, w) => vec3(w.x, p.y.mul(1.12).add(u.churn.mul(5.5)), w.y).div(STORM.cloudTile);
    /**
     * The lobes' density field at a point `h` of the way up the lobes' zone, for a given slow
     * `cover` value: only the deepest lobes hang into the bottom of the zone; a third of the way up
     * it is solid. A heavier storm hangs lower and fuller; a tier's inner wall is fuller still.
     */
    const lobeField = (p, h, cover, w, wall) => {
        const n = u.cloudNoiseSmooth(noisePoint(p, w));
        const need = mix(float(0.74), float(0.2), smoothstep(0.0, 0.46, h))
            .sub(cover.sub(0.5).mul(0.36))
            .sub(u.storm.x.sub(0.5).mul(0.12))
            .sub(wall.mul(0.2));
        return n.r.sub(need);
    };
    /** The lobes at a tap toward the light: its own tier, its own height. */
    const lobesToward = (q, cover) => {
        const there = vaultAt(q.xz);
        const h = clamp(q.y.sub(there.base).div(SPAN), 0.0, 1.0);
        return clamp(lobeField(q, h, cover, plan(q), there.wall).mul(4.2), 0.0, 1.0);
    };

    const paint = Fn(() => {
        const st = uv();
        const ndc = vec2(st.x.mul(2.0).sub(1.0), float(1.0).sub(st.y.mul(2.0)));
        const ray = normalize(
            u.camFwd.add(u.camRight.mul(ndc.x.mul(u.tanHalf.x))).add(u.camUp.mul(ndc.y.mul(u.tanHalf.y))),
        ).toVar();
        const el = ray.y.toVar();
        const up = max(el, 0.0).toVar();
        const flat = max(length(ray.xz), 1e-4).toVar();
        const az = atan(ray.x, ray.z.negate()).toVar();
        const toGlow = az.sub(STORM.glowAzimuth);
        const lobe = exp(toGlow.mul(toGlow).mul(-1.5)).toVar();
        const heavy = u.storm.x.toVar();

        // ── The clear strip ──
        const low = exp(up.mul(-18.0));
        // The light concentrates just over the far shore, whiter at its heart: the end of the
        // storm, where the evening still is.
        const core = exp(up.mul(-70.0)).mul(lobe).mul(lobe);
        const glowHeart = exp(up.mul(-160.0)).mul(lobe);
        const sky = u.gap.mul(exp(up.mul(-4.5)).mul(0.7).add(0.3))
            .add(u.horizon.mul(low.mul(lobe.mul(1.3).add(0.22)).add(core.mul(1.5))))
            .add(mix(u.horizon, vec3(1.0, 1.0, 1.0), 0.3).mul(glowHeart.mul(0.9)))
            .toVar();

        if (far) {
            // ── Far thunderheads ──
            // Other storms stand beyond this one's edge: two ranks of towering cumulus, the far one
            // pale and low, the near one darker and tall enough that its turrets rise out of sight
            // behind the vault. A turret is a heap of round domes (the outline of a row of discs,
            // smaller ones riding on the big), dark against the strip, each dome lit on the side
            // toward the evening's glow, and now and then a storm is alight from inside (silent at
            // that distance).
            for (let rank = 0; rank < 2; rank++) {
                const near = rank === 1;
                If(el.lessThan(near ? 0.21 : 0.1).and(el.greaterThan(-0.004)), () => {
                    const drift = u.vault.z.mul(near ? 0.000012 : 0.000006).add(near ? 0.37 : 0.81);
                    // Where a storm stands at all (wide gaps of clear horizon between them).
                    const mass = u.noise(vec2(az.mul(near ? 0.3 : 0.5).add(drift), near ? 0.23 : 0.61)).r;
                    const stands = smoothstep(near ? 0.46 : 0.4, near ? 0.7 : 0.62, mass).toVar();
                    /**
                     * The outline of a row of domes `cell` radians apart, up to `tall` high: the
                     * highest of the three nearest, and the slope of the one that wins (−1..1,
                     * which side of its dome this is).
                     */
                    const domes = (cell, tall, salt) => {
                        const x = az.div(cell).add(drift.mul(1.0 / cell));
                        const id = floor(x);
                        const top = float(0.0).toVar();
                        const side = float(0.0).toVar();
                        for (let k = -1; k <= 1; k++) {
                            const n = id.add(k);
                            const h1 = vsHash11(n.mul(1.13).add(salt));
                            const h2 = vsHash11(n.mul(2.71).add(salt + 19.0));
                            const centre = n.add(0.5).add(h1.sub(0.5).mul(0.7));
                            const radius = h2.mul(0.45).add(0.5);
                            const dx = x.sub(centre).div(radius);
                            // A dome on a stalk: the higher ones are whole half-circles.
                            const dome = float(1.0).sub(dx.mul(dx)).max(0.0).sqrt()
                                .mul(radius)
                                .add(h1.mul(h2).mul(0.9).mul(step(abs(dx), 1.0)));
                            const wins = step(top, dome);
                            side.assign(mix(side, clamp(dx, -1.0, 1.0), wins));
                            top.assign(max(top, dome));
                        }
                        return { top: top.mul(tall / 1.6), side };
                    };
                    const big = domes(near ? 0.085 : 0.05, near ? 0.15 : 0.062, near ? 3.0 : 41.0);
                    const small = domes(near ? 0.022 : 0.014, near ? 0.03 : 0.014, near ? 77.0 : 93.0);
                    const top = stands.mul(big.top.add(small.top.mul(stands))).toVar();
                    const edge = near ? 0.0028 : 0.002;
                    const inside = float(1.0).sub(smoothstep(top.sub(edge), top.add(edge), el))
                        .mul(step(0.004, top)).toVar();
                    const height = clamp(el.div(max(top, 1e-3)), 0.0, 1.0).toVar();
                    // The side of its dome that faces the glow is lit; the crown catches a rim of it.
                    const rim = smoothstep(0.72, 1.0, height).toVar();
                    const side = mix(big.side, small.side, rim.mul(0.5));
                    const facing = clamp(side.mul(toGlow.sign()).mul(-0.6).add(0.45), 0.0, 1.0);
                    // (Seen through miles of air: little darker than the sky it stands against.)
                    const deepDark = mix(sky, u.haze.mul(0.8).add(u.gap.mul(0.2)), near ? 0.86 : 0.62);
                    const farCol = deepDark.mul(height.mul(0.3).add(0.75))
                        .add(u.horizon.mul(lobe.mul(0.8).add(0.12))
                            .mul(facing.mul(height.mul(0.6).add(0.4)).mul(0.3).add(rim.mul(facing).mul(0.5)))
                            .mul(near ? 0.55 : 0.75))
                        .toVar();
                    // Lightning inside it: a slow swell every so often, each stretch of the horizon
                    // on its own clock, the light sitting in one turret and showing the rest dark.
                    const stretchAt = az.mul(near ? 2.2 : 3.4).add(near ? 0.5 : 9.5);
                    const stretch = floor(stretchAt).toVar();
                    const pace = vsHash11(stretch.add(near ? 3.0 : 71.0));
                    const clock = u.time.mul(pace.mul(0.09).add(0.07)).add(pace.mul(31.0));
                    const beatId = floor(clock);
                    const into = clock.sub(beatId);
                    const fires = step(near ? 0.72 : 0.62, vsHash11(beatId.mul(1.31).add(stretch.mul(7.0))));
                    const pulse = smoothstep(0.0, 0.03, into).mul(exp(into.mul(-13.0)))
                        .mul(float(1.0).add(sin(into.mul(70.0)).mul(0.2).mul(u.blink)))
                        .mul(fires);
                    const at = vsHash11(beatId.mul(3.1).add(stretch)).sub(0.5).mul(0.3);
                    const off = stretchAt.sub(stretch).sub(0.5).sub(at).mul(near ? 2.6 : 3.4);
                    const lift = height.sub(0.5).mul(1.5);
                    const glow = exp(off.mul(off).add(lift.mul(lift)).mul(2.2).negate());
                    farCol.addAssign(mix(u.flash, vec3(1.0, 0.7, 0.6), near ? 0.35 : 0.55)
                        .mul(pulse.mul(glow).mul(near ? 0.8 : 0.55)));
                    // The haze takes its foot: it stands out of the horizon, it does not sit on it.
                    const foot = smoothstep(0.0, near ? 0.03 : 0.018, el).mul(near ? 0.95 : 0.8);
                    sky.assign(mix(sky, farCol, inside.mul(foot)));
                });
            }
        }

        // Far bars of cloud lying in the strip, lit from under.
        const bars = u.noise(vec2(az.mul(0.55).add(0.2), up.mul(7.5).add(0.13)));
        const bar = smoothstep(0.5, 0.72, bars.r).mul(exp(up.mul(-9.0))).mul(smoothstep(0.012, 0.05, up));
        sky.assign(mix(sky, u.haze.mul(0.7).add(u.horizon.mul(lobe).mul(0.08)), bar.mul(0.6)));
        // Rain shafts hang in it, darker than the light behind them; a stroke lights them.
        // They lean with the wind, walk along the horizon with it, and their edges are ragged; they
        // only ever DIM what is behind them (a veil that lightened the dark cloud read as a pale
        // pillar). A heavier storm drops more of them.
        const leaned = az.add(up.mul(0.55)).add(u.drift.x.mul(0.00011)).add(u.vault.z.mul(0.00006));
        const shaftNoise = u.noise(vec2(leaned.mul(0.9), up.mul(0.6).add(0.37)));
        const frayed = u.noise(vec2(leaned.mul(4.3), up.mul(2.1).add(0.11))).r.sub(0.5).mul(0.16);
        const shaftLow = mix(float(0.66), float(0.46), heavy);
        const shaft = smoothstep(shaftLow, shaftLow.add(0.3), shaftNoise.g.add(frayed)).mul(exp(up.mul(-3.2)));
        sky.assign(sky.mul(float(1.0).sub(shaft.mul(0.5))).add(u.haze.add(u.veil.mul(0.12)).mul(shaft.mul(0.2))));
        // The far shore: a low line of hills against the strip.
        const ridge = u.noise(vec2(az.mul(0.33), 0.71)).r.mul(0.011)
            .add(u.noise(vec2(az.mul(1.6), 0.19)).g.mul(0.004))
            .add(0.001);
        const hills = float(1.0).sub(smoothstep(ridge.sub(0.0009), ridge.add(0.0009), el));
        // The shore stands dark against the light behind it.
        sky.assign(mix(sky, mix(u.haze.mul(0.32), sky, 0.14), hills));

        // ── The cell ──
        const col = vec3(0.0).toVar();
        const trans = float(1.0).toVar();
        const cover = float(0.0).toVar();
        const entry = float(0.0).toVar();
        const breath = u.breath.mul(0.6).add(0.4).toVar();
        // The cloud's own dark deepens as the storm gathers.
        const dark = mix(float(1.25), float(0.8), heavy).toVar();
        If(el.greaterThan(0.014), () => {
            const t0 = yBot.sub(u.camPos.y).div(el).toVar();
            // Above the highest tier's lobes the cloud is solid everywhere: the march ends there.
            const yTop = yBot.add(u.storm.z.mul(STORM.tiers)).add(SPAN * MARCH_TOP);
            const t1 = yTop.sub(u.camPos.y).div(el).toVar();
            entry.assign(t0);
            If(t0.mul(flat).lessThan(STORM.edge + 900), () => {
                // A low ray crosses a long run of the slab: it gets more steps (about one per
                // MARCH_GROUND metres of ground, up to a few times the tier's count), so the lobes
                // it passes are not smeared into streaks along it.
                const tEnd = min(t1, float(STORM.edge + 700).div(flat)).toVar();
                const run = tEnd.sub(t0).mul(flat);
                // (The count is not rounded where the step's length is worked out: a whole number
                // of steps changes from one ray to its neighbour in a jump, and every jump is a
                // contour drawn across the cloud. The last step simply runs a little past the end.)
                const stepsExact = clamp(run.div(MARCH_GROUND), float(march), float(march * stepBudget)).toVar();
                const steps = stepsExact.ceil().toVar();
                const ds = tEnd.sub(t0).div(stepsExact).toVar();
                // A different start per pixel hides the steps. A plain hash, not interleaved
                // gradient noise: that one is a lattice, and with nothing to average it over time
                // the lattice beats against the steps into rings along every tier's wall.
                const jitter = vsHash21(floor(screenCoordinate.xy));
                const lightWay = vec3(LIGHT_WAY[0], LIGHT_WAY[1], LIGHT_WAY[2]);
                // Forward scatter: how nearly this ray looks into the strip's light.
                const toward = smoothstep(0.15, 0.97, dot(ray, lightWay)).mul(0.8).add(0.2).toVar();
                const pixelFlash = vec3(0.0).toVar();
                if (!flashSteps) {
                    const mid = u.camPos.add(ray.mul(t0.add(tEnd.sub(t0).mul(0.4))));
                    pixelFlash.assign(cloudFlash(mid.add(vec3(0.0, 60.0, 0.0)), 'fp'));
                }
                const sheetAge = u.time.sub(u.sheet.z);
                const sheetFront = max(sheetAge, 0.0).mul(u.sheetLook.w).toVar();
                // (A slow front fades slowly: it is seen crossing the whole vault.)
                const sheetFade = u.sheetLook.w.div(1500.0).mul(0.85);
                const sheetGain = u.sheet.w.mul(step(0.0, sheetAge)).mul(exp(max(sheetAge, 0.0).mul(sheetFade).negate()))
                    .toVar();
                const sheetWide = mix(float(520.0), float(260.0), smoothstep(300.0, 1500.0, u.sheetLook.w)).toVar();
                Loop({
                    start: int(0), end: int(steps), type: 'int', condition: '<', name: 'ms',
                }, ({ ms }) => {
                    // (A ray that is already blind costs its remaining steps nothing.)
                    If(trans.greaterThan(0.012), () => {
                        const t = t0.add(ds.mul(float(ms).add(jitter)));
                        const p = u.camPos.add(ray.mul(t)).toVar();
                        const vault = vaultAt(p.xz);
                        const above = p.y.sub(vault.base).toVar();
                        const wall = vault.wall.toVar();
                        // Under this tier's base there is only air.
                        If(above.greaterThan(0.0), () => {
                            const w = plan(p).toVar();
                            // (Two mips down: the field's finest octave is four texels wide, and a
                            // bilinear read of it is creased along every texel row: seen edge-on
                            // from under the cloud those rows are ripples across its lit fringes.)
                            const slow = u.noiseLod(w.div(STORM.coverTile), 2).r.toVar();
                            const out = length(p.xz).add(slow.sub(0.5).mul(1500.0));
                            // The cell ends: beyond its edge the clear strip shows.
                            const inCell = float(1.0).sub(smoothstep(STORM.edge - EDGE_BAND, STORM.edge, out)).toVar();
                            // The eye a perfect clear opens: the cloud draws back from a ring that
                            // widens with height (a funnel: narrow at the vault's underside, wide
                            // above it, so the lens looks up its far wall into the sky), ragged at
                            // its lip.
                            const eyeRadius = u.eye.z.mul(u.eye.w).add(above.mul(EYE_FLARE)).toVar();
                            const fromEye = length(p.xz.sub(u.eye.xy)).add(slow.sub(0.5).mul(170.0)).toVar();
                            const eyeOpen = float(1.0).sub(smoothstep(eyeRadius.mul(0.62), eyeRadius.add(1.0), fromEye))
                                .mul(step(0.002, u.eye.w))
                                .toVar();
                            inCell.mulAssign(float(1.0).sub(eyeOpen));
                            const h = clamp(above.div(SPAN), 0.0, 1.0).toVar();
                            const field = lobeField(p, h, slow, w, wall).toVar();
                            const coarse = clamp(field.mul(4.2), 0.0, 1.0).toVar();
                            const d = coarse.mul(inCell).toVar();
                            const solid = step(MARCH_TOP, h).toVar();
                            If(field.greaterThan(detail ? -0.12 : 0.001).and(inCell.greaterThan(0.002)), () => {
                                if (detail) {
                                    // Smaller billows ride on the lobes and fray their edges.
                                    const e = u.cloudNoise(noisePoint(p, w).mul(3.7)
                                        .add(vec3(0.31, u.churn.mul(0.045).add(0.17), 0.53)));
                                    const billow = e.g.sub(0.56).mul(float(0.26).sub(h.mul(0.14)));
                                    d.assign(clamp(field.add(billow).mul(6.5), 0.0, 1.0).mul(inCell));
                                }
                                // Deep inside it is simply full.
                                d.assign(max(d, solid.mul(inCell)));
                                // How low it hangs: 1 at a lobe's tip, 0 in the recesses and deep inside.
                                const lowness = float(1.0).sub(smoothstep(0.0, 0.36, h)).toVar();
                                // The strip's light reaches in under the cell from its edge: the far cloud
                                // is lit, the cloud overhead is not, and what hangs low in between stands
                                // dark against the lit cloud behind it.
                                const reachOut = smoothstep(150.0, STORM.edge, length(p.xz));
                                const lightIn = reachOut.mul(reachOut.mul(0.6).add(0.4)).toVar();
                                let lit = float(0.6);
                                let facing = float(0.5);
                                if (detail) {
                                    const near1 = lobesToward(p.add(lightWay.mul(LIGHT_NEAR)), slow).toVar();
                                    const near2 = lobesToward(p.add(lightWay.mul(LIGHT_FAR)), slow);
                                    lit = exp(near1.mul(0.9).add(near2.mul(1.8)).negate());
                                    // Thinner toward the light than here: this side of the lobe faces it.
                                    facing = clamp(coarse.sub(near1).mul(1.2).add(0.5), 0.0, 1.0);
                                }
                                // Recesses go deep; a lobe's lit side against its shadowed one is several
                                // times brighter (each factor's floor was high, and together they flattened
                                // the cloud into one grey).
                                const body = u.cloud.mul(lowness.mul(1.0).add(0.25)).mul(dark);
                                // Near the cell's edge the lobes catch the strip's own colour.
                                const keyCol = mix(u.rim, u.horizon.mul(0.55), lightIn.mul(lightIn).mul(0.8)).mul(1.2).toVar();
                                const key = keyCol.mul(lightIn.mul(0.9).add(0.08)).mul(lit.mul(0.85).add(0.15))
                                    .mul(lowness.mul(0.7).add(0.3))
                                    .mul(lobe.mul(1.2).add(0.35))
                                    .mul(facing.mul(facing).mul(1.3).add(0.22));
                                // A little of it comes THROUGH a lobe's thin edge, looking toward the strip:
                                // every tier's lower lip is a fringe of that light.
                                const thin = float(1.0).sub(smoothstep(0.06, 0.62, d));
                                const silver = keyCol.mul(lit).mul(thin).mul(toward).mul(lightIn.add(wall.mul(0.25)))
                                    .mul(1.25);
                                // The evening above the eye pours down its walls: brightest on a
                                // wall's face, sinking a little way into the cloud, and it shows the
                                // wall's own build (where the cloud is thick it is dim, thin it burns).
                                const inWall = max(fromEye.sub(eyeRadius), 0.0);
                                const eyeLit = exp(inWall.div(-230.0)).mul(u.eye.w)
                                    .mul(mix(float(1.15), float(0.35), smoothstep(0.0, 0.45, field)))
                                    .mul(smoothstep(0.0, 0.3, h).mul(0.6).add(0.4));
                                const own = body.add(key).add(silver).mul(breath)
                                    .add(mix(u.horizon, vec3(1.0, 0.96, 0.9), 0.5).mul(eyeLit.mul(0.6)));
                                // A stroke burns deep in the slab: what hangs in front of it is its shadow.
                                const deep = smoothstep(0.04, 0.42, h);
                                const depth = deep.mul(deep).mul(0.95).add(0.05).toVar();
                                const struck = (flashSteps ? cloudFlash(p, 'fs') : pixelFlash).toVar();
                                // Light that has come through cloud is deeper in colour: white only
                                // at a stroke's heart, its own hue across the rest of what it lights
                                // (and a soft ceiling: beside a stroke the cloud glows, never blanks).
                                const peak = max(struck.x, max(struck.y, struck.z)).toVar();
                                const hue = struck.div(max(peak, 1e-4)).toVar();
                                const deepHue = mix(hue.mul(hue), hue, smoothstep(0.15, 1.6, peak));
                                // And it shows what it passes through: where the cloud is thick it is
                                // dim, where it is thin it burns, so a stroke draws the cloud's own
                                // build in light instead of washing it out.
                                const thick = smoothstep(0.02, 0.5, field);
                                const through = mix(float(1.0), float(0.16), thick.mul(deep));
                                // (Lit once per pixel, on the low tiers, the light cannot follow the
                                // cloud's depth without the march's own grain showing in it: there it
                                // is one even glow, dimmer where the cloud is thick.)
                                const shaped = flashSteps ? depth.mul(through) : mix(float(0.42), float(0.2), thick);
                                const flash = deepHue.mul(peak.mul(shaped).div(peak.mul(0.7).add(1.0)));
                                const fromSheet = length(p.xz.sub(u.sheet.xy)).sub(sheetFront).div(sheetWide);
                                const sheetBand = exp(fromSheet.mul(fromSheet).negate()).mul(sheetGain);
                                const sheet = u.sheetLook.xyz.mul(sheetBand.mul(depth).mul(through).mul(0.8));
                                const a = float(1.0).sub(exp(d.mul(ds).div(-EXTINCTION)));
                                // A solid step ends the ray.
                                const stop = max(a, solid.mul(inCell));
                                col.addAssign(own.add(flash).add(sheet).mul(trans).mul(stop));
                                trans.mulAssign(float(1.0).sub(stop));
                            });
                        });
                    });
                });
                // What is left of the ray ends in the cell's dark heart (lit, deep inside, by a
                // stroke) or, past the cell's edge or through the eye, in the clear sky.
                const exit = u.camPos.add(ray.mul(t1)).toVar();
                cover.assign(float(1.0).sub(smoothstep(STORM.edge - EDGE_BAND, STORM.edge + 250, length(exit.xz))));
                const eyeWide = u.eye.z.mul(u.eye.w).add(max(exit.y.sub(yBot).sub(u.storm.z), 0.0).mul(EYE_FLARE));
                const eyeTop = float(1.0).sub(smoothstep(eyeWide.mul(0.85), eyeWide.add(1.0), length(exit.xz.sub(u.eye.xy))))
                    .mul(step(0.002, u.eye.w));
                const heart = u.cloud.mul(0.3).mul(breath).mul(dark)
                    .add((flashSteps ? cloudFlash(exit, 'fe') : pixelFlash).mul(0.3));
                // Through the eye: the evening above the storm, deep and clear, the first stars out.
                const starAt = vec2(az, el).mul(430.0).toVar();
                const starCell = floor(starAt);
                const starSeed = vsHash11(starCell.x.add(starCell.y.mul(57.0)).add(400.0));
                const starOff = fract(starAt).sub(0.5);
                const star = step(0.93, starSeed).mul(exp(dot(starOff, starOff).mul(-26.0)))
                    .mul(starSeed.sub(0.9).mul(10.0));
                const evening = mix(u.horizon.mul(0.62), u.gap.mul(1.15), smoothstep(0.1, 0.42, el))
                    .add(vec3(0.85, 0.92, 1.0).mul(star.mul(0.9)));
                col.addAssign(mix(mix(sky, heart, cover), evening, eyeTop.mul(u.eye.w)).mul(trans));
                trans.assign(0.0);
            }).Else(() => {
                col.assign(sky);
                trans.assign(0.0);
            });
        }).Else(() => {
            col.assign(sky);
            trans.assign(0.0);
        });

        // ── A twist's funnel ──
        // The cloud over the hero tower winds down into a funnel: a tapering, leaning column from
        // the vault's underside toward the tower's finial, banded where it turns, dark against the
        // strip with its edge catching it. It is drawn where the view ray passes its axis (it is a
        // soft thing a few metres across: no march is spent on it).
        If(u.funnel.z.greaterThan(0.01), () => {
            const topY = vaultAt(u.funnel.xy).base.add(30.0).toVar();
            const botY = mix(topY, float(FUNNEL_TIP), u.funnel.z).toVar();
            const rel = u.camPos.xz.sub(u.funnel.xy).toVar();
            const way = ray.xz.div(flat).toVar();
            const along = dot(rel, way).negate().toVar();
            // The ray's height where it passes the axis, and how far up the funnel that is.
            const yAt = u.camPos.y.add(el.div(flat).mul(along)).toVar();
            const k = clamp(yAt.sub(botY).div(max(topY.sub(botY), 1.0)), 0.0, 1.0).toVar();
            // It leans and snakes as a rope of cloud does, most at its tip.
            const lean = sin(k.mul(2.6).add(u.funnel.w.mul(0.35))).mul(float(1.0).sub(k)).mul(16.0);
            const miss = rel.x.mul(way.y).sub(rel.y.mul(way.x)).add(lean).toVar();
            // (Ragged: its width swells and thins along it, and the swellings climb as it turns.)
            const ragged = u.noise(vec2(k.mul(1.7).sub(u.funnel.w.mul(0.04)), 0.41)).r.mul(0.7).add(0.65);
            const radius = mix(float(5.0), float(70.0), k.mul(k).mul(k.mul(0.5).add(0.5))).mul(ragged).toVar();
            const across = miss.div(radius).toVar();
            const within = step(0.0, along).mul(step(botY, yAt)).mul(step(yAt, topY.add(40.0)));
            const dens = float(1.0).sub(smoothstep(0.5, 1.0, abs(across))).mul(within)
                .mul(smoothstep(0.0, 0.06, k).mul(0.8).add(0.2))
                .toVar();
            // Bands wound round it, climbing as it turns.
            const round = clamp(across, -1.0, 1.0).mul(1.4);
            const bands = sin(round.mul(2.2).add(k.mul(17.0)).sub(u.funnel.w)).mul(0.5).add(0.5);
            const edge = smoothstep(0.35, 0.95, abs(across));
            const axisPoint = vec3(u.funnel.x, yAt, u.funnel.y);
            // Dark, as a thing of the cloud is: only the edge toward the strip's glow catches it.
            const glowSide = clamp(across.mul(toGlow.sign()).mul(-1.0), 0.0, 1.0);
            const funnelCol = u.cloud.mul(bands.mul(0.5).add(0.3)).mul(breath)
                .add(mix(u.rim, u.horizon.mul(0.6), 0.5).mul(edge.mul(glowSide).mul(lobe.mul(0.9).add(0.3)).mul(0.4)))
                .add(u.chain.mul(bands.mul(float(1.0).sub(k)).mul(0.07)))
                .add(cloudFlash(axisPoint, 'ff').mul(bands.mul(0.25).add(0.08)));
            col.assign(mix(col, funnelCol, dens.mul(0.94)));
        });

        if (scud) {
            // ── Scud ──
            // Ragged fragments race under the lowest tier, faster than the vault turns and across
            // it: soft-edged, dark against whatever the storm lights behind them, the side toward
            // the strip a little lit. They come in as the storm gathers and are gone in its lull.
            If(u.storm.w.greaterThan(0.02).and(el.greaterThan(0.05)), () => {
                const ys = yBot.sub(STORM.scudUnder);
                const ts = ys.sub(u.camPos.y).div(el).toVar();
                const ps = u.camPos.add(ray.mul(ts)).toVar();
                const reach = ts.mul(flat).toVar();
                // Near the lens only: far off, a thin layer seen edge-on is a row of dashes.
                const under = float(1.0).sub(smoothstep(900.0, 1700.0, reach));
                const q = ps.xz.add(u.vault.zw).toVar();
                // (The eased read: seen edge-on, a plain one shows the noise's own voxels as scales.)
                const at = (xz, lift) => u.cloudNoiseSmooth(vec3(xz.x, u.churn.mul(11.0).add(lift), xz.y).div(700.0));
                const n1 = at(q, 0.0).toVar();
                // A second read a little higher up the ray: the fragments have depth, not an outline.
                const n2 = at(q.add(ray.xz.div(el).mul(46.0)), 46.0).toVar();
                // And one toward the strip's light: the side that faces it is thinner there.
                const n3 = at(q.add(vec2(LIGHT_WAY[0], LIGHT_WAY[2]).mul(70.0)), 0.0);
                const shape = n1.r.mul(0.6).add(n2.r.mul(0.4)).add(n1.g.sub(0.5).mul(0.22)).toVar();
                const need = mix(float(0.8), float(0.55), u.storm.w);
                const dens = smoothstep(need, need.add(0.3), shape).mul(under).toVar();
                const lit = clamp(n1.r.sub(n3.r).mul(3.0).add(0.4), 0.0, 1.0);
                const far2 = smoothstep(150.0, 1500.0, reach);
                const litBy = cloudFlash(ps.add(vec3(0.0, 40.0, 0.0)), 'fc');
                const scudCol = u.cloud.mul(0.7).mul(breath)
                    .add(mix(u.rim, u.horizon.mul(0.5), far2).mul(lit.mul(lobe.mul(0.8).add(0.3)).mul(far2.mul(0.5).add(0.1))))
                    .add(litBy.mul(lit.mul(0.1).add(0.03)));
                col.assign(mix(col, scudCol, dens.mul(0.86)));
            });
        }

        // ── Rain curtains ──
        // Between the lens and the far shore the rain hangs in curtains that walk along with the
        // wind: each takes a little of what stands behind it into the haze, falls in streaks, and
        // takes the strokes' light (a bolt behind a curtain glows through it). A heavy storm hangs
        // them thick; in a lull the air is clear to the horizon.
        if (curtains) {
            If(heavy.greaterThan(0.12).and(el.greaterThan(-0.004)).and(el.lessThan(0.5)), () => {
                const walk = az.add(up.mul(0.42)).add(u.vault.z.mul(0.00021)).toVar();
                const hang = u.noise(vec2(walk.mul(0.7), 0.83)).g.mul(0.62)
                    .add(u.noise(vec2(walk.mul(2.3), 0.27)).r.mul(0.38));
                const streaks = u.noise(vec2(walk.mul(26.0), up.mul(1.6).sub(u.rainClock.mul(0.31)))).r;
                const reachUp = exp(up.mul(-5.5));
                const curtain = smoothstep(0.52, 0.8, hang).mul(reachUp)
                    .mul(streaks.mul(0.5).add(0.6))
                    .mul(smoothstep(0.12, 0.75, heavy))
                    .toVar();
                col.assign(mix(col, u.haze.mul(1.1).add(u.veil.mul(0.22)), curtain.mul(0.42)));
            });
        }

        // Distance and rain take the far cloud toward the haze.
        const veiled = float(1.0).sub(exp(entry.div(-7000.0))).mul(cover).mul(0.75);
        col.assign(mix(col, u.haze, veiled));
        if (!u.floatSky) return vec4(sqrt(clamp(col.div(SKY_CODE_PEAK), 0.0, 1.0)), 1.0);
        return vec4(col, 1.0);
    });

    const material = vsPassMaterial('VoltageStormSkyPass', paint());
    const quad = new THREE.QuadMesh(material);
    quad.name = 'VoltageStormSkyPass';
    let target = vsTarget(4, 4, 'voltage-storm-sky', u.floatSky);
    u.skyTex.value = target.texture;

    // The backdrop: the target, stretched over the frame behind everything.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const backdrop = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    backdrop.name = 'VoltageStormBackdrop';
    backdrop.fog = false;
    backdrop.vertexNode = vec4(positionGeometry.xy, 1.0, 1.0);
    // Four taps half a texel out: the march's per-pixel jitter is averaged away, the picture is not.
    backdrop.colorNode = Fn(() => {
        // (Wider on the tiers that march the cloud in few, long steps: their grain is coarser.)
        const texel = vec2(1.0, 1.0).div(u.skyTexel).mul(detail ? 0.72 : 0.95);
        const sum = u.skyAt(screenUV.add(texel.mul(vec2(1.0, 0.33))))
            .add(u.skyAt(screenUV.add(texel.mul(vec2(-0.33, 1.0)))))
            .add(u.skyAt(screenUV.add(texel.mul(vec2(-1.0, -0.33)))))
            .add(u.skyAt(screenUV.add(texel.mul(vec2(0.33, -1.0)))));
        return vec4(sum.mul(0.25), 1.0);
    })();
    const part = vsPart('VoltageStormBackdrop', geometry, backdrop, -100);

    part.pass = { quad, material };
    /** Size the target for a drawing buffer and a tier's scale. Returns true if it was rebuilt. */
    part.resize = (bufferWidth, bufferHeight, scale) => {
        const w = Math.max(2, Math.round(bufferWidth * scale));
        const h = Math.max(2, Math.round(bufferHeight * scale));
        if (target.width === w && target.height === h) return false;
        target.dispose();
        target = vsTarget(w, h, 'voltage-storm-sky', u.floatSky);
        u.skyTex.value = target.texture;
        u.skyTexel.value.set(w, h);
        return true;
    };
    /** Paint the sky for this frame (the camera uniforms must be current). */
    part.render = (renderer) => {
        if (!renderer || typeof renderer.setRenderTarget !== 'function') return false;
        const previous = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
        renderer.setRenderTarget(target);
        quad.render(renderer);
        renderer.setRenderTarget(previous);
        return true;
    };
    part.target = () => target;
    part.dispose = () => {
        target.dispose();
        material.dispose();
    };
    part.march = march;
    return part;
}

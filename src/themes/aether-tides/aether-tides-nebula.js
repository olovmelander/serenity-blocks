/**
 * Aether Tides — the picture.
 *
 * One full-screen triangle turns the fluid into a nebula, back to front:
 *
 *   the deep sky   a dark gradient, a far haze and three depths of stars, all dimmed by the dust
 *                  and gas in front of them (that dimming is what gives the picture its depth)
 *   the gas        the dye's colour, read through the woven coordinates so its fine grain is
 *                  stretched and folded by the same flow; a thick cloud glows whole while its thin
 *                  edges fray into wisps; brighter and whiter where it is hot
 *   the light      the Tide Star and its companion light whatever their light reaches: each
 *                  column of gas and dust catches it in proportion to its thickness, and the
 *                  light buffer says how much arrives. A cloud wears a bright edge on the side that
 *                  faces a star (an ionisation front) and is dark behind, and the thin air between
 *                  shows the shafts its shadows cut (aether-tides-light.js)
 *   the events     blast fronts drawn as burning rings that bend the light behind them as they
 *                  pass; the maelstrom bends everything behind it
 *
 * Between two simulation steps the fluid is extrapolated along its own velocity, so the picture
 * moves at the display's rate whatever the solver's.
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
    mix,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    step,
    uniform,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    RING_LIFE,
    RING_ROWS,
    RING_TAU,
    ROW_RING,
    atHash22,
    atHash23,
    atLuma,
    atMax3,
} from './aether-tides-tsl.js';

/** Uniforms of the picture. */
export function createPictureUniforms() {
    return {
        /**
         * The frame: the tide-space point at the centre of the screen, and the magnification
         * (1 = the whole tide space; the theme never changes it, the icon lens does).
         */
        frame: uniform(new THREE.Vector3(0, 0, 1)),
        /** Parallax pan, tide units: the deep sky slides against the gas. */
        view: uniform(new THREE.Vector2(0, 0)),
        /** Physical pixels per tide unit (stars are sized in pixels). */
        pixels: uniform(540),
        deep: uniform(new THREE.Color(0.006, 0.008, 0.03)),
        dustTint: uniform(new THREE.Color(0.5, 0.36, 0.3)),
        shock: uniform(new THREE.Color(0.7, 0.9, 1.0)),
        /** The Tide Star and its companion: tide-space positions, colours, flux. */
        starA: uniform(new THREE.Vector2(-1.2, -0.5)),
        starB: uniform(new THREE.Vector2(1.2, 0.5)),
        starColorA: uniform(new THREE.Color(0.72, 0.86, 1.0)),
        starColorB: uniform(new THREE.Color(1.0, 0.62, 0.3)),
        starFlux: uniform(new THREE.Vector2(1, 0.62)),
        /** How bright the gas glows by itself, and how much the heat adds. */
        glow: uniform(1.0),
        hot: uniform(1.0),
        /** The dust's grip on what lies behind it, and on the light that crosses it. */
        murk: uniform(5.0),
        shadow: uniform(3.4),
        /** How much of the stars' light the gas and the dust throw back. */
        scatter: uniform(0.4),
        /** How much harder the gas glows where a star's light reaches it. */
        excite: uniform(1.7),
        /** The bright edge a cloud wears on the side that faces a star (an ionisation front). */
        rim: uniform(2.5),
        /** The thin gas between the clouds, lit where nothing shades it: the shafts. */
        shafts: uniform(1.5),
        /** How hard a blast front bends the light of what lies behind it. */
        ripple: uniform(1.0),
        /** Everything sinks for an instant before a four-line clear fires. */
        hush: uniform(0),
        /** The maelstrom: tide-space centre, its radius, how open it is (0..1). */
        well: uniform(new THREE.Vector4(1.0, 0.4, 0.12, 0)),
        time: uniform(0),
    };
}

/** Tide units the picture walks toward each great star at the dye's resolution (ionisation fronts). */
const NEAR_RUN = 0.07;

/** The far galaxy's band: its direction on screen (tide space, y down: rising to the right). */
const BAND_AXIS = vec2(Math.cos(-0.5), Math.sin(-0.5));
/**
 * The maelstrom's disc, in hole radii: how far it is turned off level, how flat it is seen (nearly
 * edge on), where it begins (outside the photon ring) and how far it runs.
 */
const DISC_TURN = -0.2;
const DISC_COS = Math.cos(DISC_TURN);
const DISC_SIN = Math.sin(DISC_TURN);
const DISC_FLAT = 0.14;
const DISC_INNER = 1.5;
const DISC_OUTER = 1.9;
/** Seconds each of the disc's two streak reads lives before it is faded out and begun again. */
const DISC_CYCLE = 6.0;

/** Cells per tide unit of the faraway galaxies (about one in five holds one). */
const GALAXY_CELLS = 2.4;

/** Debug views of the picture (the playground's `view=`): one channel each, unlit. */
export const NEBULA_VIEWS = Object.freeze(['dust', 'gas', 'shade', 'rim', 'shafts', 'fronts']);

/**
 * @param {object} options
 * @param {object} options.tide       createTideUniforms()
 * @param {object} options.picture    createPictureUniforms()
 * @param {object} options.fluid      TideFluid (its texture nodes)
 * @param {object} options.light      TideLight
 * @param {object} options.tier       quality tier
 * @param {Function} options.field    (q) → vec4: the resting nebula, drawn as it stands when the
 *                                    fluid cannot run (no half-float targets on this device)
 * @param {string|null} [options.view] one of NEBULA_VIEWS: draw that channel instead (debug)
 */
export function createNebula({
    tide: U, picture: P, fluid, light, tier, field, view = null,
}) {
    const {
        tVel, tDye, tWeave, tNoise,
    } = fluid;
    const ev = U.events;

    // Screen fractions with y down, from the triangle itself (the same on both backends).
    const vSt = varying(vec2(positionGeometry.x.mul(0.5).add(0.5), positionGeometry.y.mul(-0.5).add(0.5)));

    /** One depth of stars. `p` in tide units; `density` cells per unit; returns linear rgb. */
    const starLayer = (p, density, seed, gain, sharp) => {
        const g = p.mul(density).add(seed);
        const cell = floor(g);
        const f = fract(g);
        const rnd = atHash23(cell.add(seed * 3.1)).toVar();
        const at = atHash22(cell.add(seed * 7.7 + 0.5)).mul(0.7).add(0.15);
        // Distance in pixels, so a star stays a point at any resolution.
        const dPx = length(f.sub(at)).div(density).mul(P.pixels).mul(P.frame.z);
        // Few bright, many faint.
        const mag = pow(rnd.x, sharp).mul(gain);
        const twinkle = float(0.8).add(float(0.2).mul(
            fract(rnd.y.mul(7.0).add(P.time.mul(rnd.z.mul(0.9).add(0.25)))).sub(0.5).abs().mul(2.0),
        ));
        // A brighter star is a slightly wider disc, as a lens draws it.
        const core = exp(dPx.mul(dPx).mul(-0.9).div(mag.mul(0.5).add(1.0)));
        const halo = exp(dPx.mul(-0.5)).mul(0.1).mul(smoothstep(0.4, 1.0, rnd.x));
        // Mostly blue-white; a quarter warm, a few deep orange giants.
        const giant = vec3(1.0, 0.5, 0.26);
        const warm = vec3(1.0, 0.76, 0.52);
        const cold = vec3(0.66, 0.8, 1.0);
        const tint = mix(mix(giant, warm, smoothstep(0.02, 0.07, rnd.z)), cold, smoothstep(0.1, 0.36, rnd.z));
        return tint.mul(core.add(halo)).mul(mag).mul(twinkle);
    };

    const fragment = Fn(() => {
        const st = vSt;
        const q = st.sub(0.5).mul(U.screen).mul(2.0).div(P.frame.z)
            .add(P.frame.xy)
            .toVar();
        const now = U.time.add(U.ahead);

        // ── Blast fronts: the light of each, and the ripple it bends the light behind it with ──
        const fronts = vec3(0.0).toVar();
        const bend = vec2(0.0).toVar();
        Loop({
            start: int(0), end: int(U.ringCount), type: 'int', condition: '<',
        }, ({ i }) => {
            const r0 = ev.element(i.mul(RING_ROWS).add(ROW_RING));
            const r1 = ev.element(i.mul(RING_ROWS).add(ROW_RING + 1));
            const age = now.sub(r0.z);
            const live = step(0.0, age).mul(step(age, RING_LIFE));
            const sink = exp(age.max(0.0).div(RING_TAU).negate());
            const radius = r0.w.mul(float(1.0).sub(sink)).toVar();
            const d = q.sub(r0.xy).toVar();
            const dist = length(d).toVar();
            const strength = sink.mul(live).toVar();
            const burn = strength.mul(r1.z.mul(0.12));
            // A hair-thin front with a soft wake behind it; its edges fringe faintly by colour
            // (the split is a fraction of the line's own width, never a rainbow).
            const w = r1.y.mul(0.22).toVar();
            const line = (shift) => {
                const x = dist.sub(radius).sub(w.mul(shift)).div(w);
                return exp(x.mul(x).negate());
            };
            const wake = exp(max(radius.sub(dist), 0.0).div(r1.y.mul(1.6)).negate())
                .mul(step(dist, radius)).mul(0.1);
            fronts.addAssign(vec3(line(0.3), line(0.0), line(-0.3)).add(wake).mul(burn));
            // The gas the front piles up is a lens: what lies just ahead of it is drawn in, what
            // lies just behind is pushed out, so the stars and the gas crowd onto the front.
            const x = dist.sub(radius).div(r1.y.mul(1.4));
            const ripple = x.mul(exp(x.mul(x).negate())).mul(strength).mul(r1.y).mul(2.6);
            bend.addAssign(d.div(dist.add(1e-4)).mul(ripple));
        });

        // ── The maelstrom bends the light of everything behind it ──
        const toWell = q.sub(P.well.xy).toVar();
        const wellDist = length(toWell).toVar();
        const wellR2 = P.well.z.mul(P.well.z);
        const lens = P.well.w.mul(wellR2).div(wellDist.mul(wellDist).add(wellR2.mul(0.35)));
        const ql = q.sub(toWell.mul(clamp(lens, 0.0, 0.92))).add(bend.mul(P.ripple)).toVar();

        // ── The fluid here, carried forward to this instant ──
        const fuv0 = ql.div(U.half.mul(2.0)).add(0.5);
        const flow = tVel.sample(fuv0).toVar();
        const fuv = fuv0.sub(flow.xy.mul(U.ahead).div(U.half.mul(2.0))).toVar();
        const dye = (fluid.live ? tDye.sample(fuv) : field(ql)).toVar();
        const weave = tWeave.sample(fuv).toVar();
        const heat = clamp(flow.z, 0.0, 8.0).toVar();

        // Fine grain through both sets of woven coordinates, cross-faded.
        const woven = (offsetUv, scale, shift) => fuv.add(offsetUv).mul(U.half).mul(2.0).mul(scale)
            .add(shift);
        const grainAt = (offsetUv) => {
            const broad = tNoise.sample(woven(offsetUv, 0.46, vec2(0.13, 0.71)));
            const fine = tNoise.sample(woven(offsetUv, 1.55, vec2(0.61, 0.29)));
            return vec4(broad.x, fine.y, fine.z, broad.w);
        };
        const grain = mix(grainAt(weave.zw), grainAt(weave.xy), U.weaveMix).toVar();
        // Filaments: the ridges of the fine grain, drawn over the broad billows.
        const ridge = float(1.0).sub(abs(grain.y.sub(0.5)).mul(2.0)).toVar();
        const billow = smoothstep(0.2, 0.85, grain.x).toVar();
        const frayed = mix(0.38, 1.0, billow).mul(mix(0.72, 1.5, smoothstep(0.45, 0.98, ridge)));
        // A thick cloud glows whole; the grain carves its thin edges into wisps.
        const thick = smoothstep(0.3, 1.25, atMax3(dye.rgb));
        const weft = mix(frayed, mix(0.86, 1.12, billow), thick.mul(0.75));

        const gas = dye.rgb.mul(weft).toVar();
        const density = atMax3(gas).toVar();
        // The dust, drawn into lanes along the filaments.
        const lanes = smoothstep(0.4, 0.95, ridge);
        const dust = dye.a.mul(mix(0.45, 1.5, smoothstep(0.12, 0.92, grain.z))).mul(mix(0.8, 1.25, lanes))
            .mul(mix(0.8, 1.15, grain.w))
            .toVar();
        const tauDust = dust.mul(P.murk).toVar();
        const tauGas = density.mul(0.55).toVar();

        // ── The deep sky ──
        const pan = P.view;
        const sky = P.deep.mul(float(0.85).sub(st.y.mul(0.35))).toVar();
        const haze = tNoise.sample(ql.add(pan.mul(0.2)).mul(0.1).add(vec2(0.31, 0.57)));
        const far = mix(P.deep.mul(2.4), vec3(0.022, 0.008, 0.034), haze.y);
        sky.addAssign(far.mul(smoothstep(0.45, 0.9, haze.x)).mul(0.5));
        const stars = vec3(0.0).toVar();
        // A far galaxy's band crosses the sky behind the nebula, from the lower left to the upper
        // right (through the open corners the river leaves): a glow of stars too far to resolve,
        // gathered into clouds and cut by its own dark lanes, and thick with faint stars.
        const deepQ = ql.add(pan.mul(0.05)).toVar();
        const along = dot(deepQ, BAND_AXIS);
        const across = dot(deepQ, vec2(BAND_AXIS.y.negate(), BAND_AXIS.x)).sub(sin(along.mul(0.8).add(0.4)).mul(0.14));
        const band = exp(across.mul(across).mul(-6.5)).toVar();
        const clouds = tNoise.sample(deepQ.mul(vec2(0.16, 0.16)).add(vec2(0.71, 0.13))).level(1.5);
        const threads = float(1.0).sub(abs(clouds.y.sub(0.5)).mul(2.0));
        const lane = smoothstep(0.62, 0.95, threads).mul(smoothstep(0.35, 0.9, band));
        const milk = band.mul(mix(0.35, 1.25, smoothstep(0.3, 0.75, clouds.x))).mul(float(1.0).sub(lane.mul(0.8)))
            .toVar();
        sky.addAssign(P.deep.mul(1.8).add(vec3(0.022, 0.019, 0.026)).mul(milk));
        if (tier.farSky) {
            // Its own stars: few of them bright, gathered where its clouds are.
            const gathered = milk.mul(milk).mul(smoothstep(0.35, 0.8, clouds.x));
            stars.addAssign(starLayer(deepQ, 64.0, 53.0, 1.3, 9.0).mul(gathered));
            // A few galaxies far beyond it: small soft ovals with bright hearts, turned every way.
            const gq = deepQ.mul(GALAXY_CELLS).add(5.0);
            const gCell = floor(gq);
            const gh = atHash23(gCell.add(91.0)).toVar();
            const gAt = atHash22(gCell.add(17.3)).mul(0.5).add(0.25);
            const gd = fract(gq).sub(gAt).div(GALAXY_CELLS);
            const gTurn = gh.y.mul(Math.PI);
            const gc = cos(gTurn);
            const gs = sin(gTurn);
            const gr = vec2(gd.x.mul(gc).add(gd.y.mul(gs)), gd.y.mul(gc).sub(gd.x.mul(gs)))
                .div(vec2(1.0, mix(0.22, 0.85, gh.z)))
                .div(mix(0.012, 0.03, gh.x));
            const gr2 = dot(gr, gr);
            const galaxy = exp(gr2.mul(-2.2)).mul(0.5).add(exp(gr2.mul(-28.0)).mul(1.4))
                .mul(step(0.78, fract(gh.x.mul(7.31))));
            sky.addAssign(mix(vec3(1.0, 0.86, 0.7), vec3(0.75, 0.82, 1.0), gh.z).mul(galaxy.mul(0.11)));
        }
        stars.addAssign(starLayer(ql.add(pan.mul(0.08)), 38.0, 11.0, 0.5, 5.0));
        stars.addAssign(starLayer(ql.add(pan.mul(0.16)), 14.0, 23.0, 3.0, 16.0));
        if (tier.starLayers > 2) stars.addAssign(starLayer(ql.add(pan.mul(0.3)), 6.0, 37.0, 11.0, 26.0));
        const veil = exp(tauDust.add(tauGas).negate());
        const out = sky.add(stars).mul(veil).toVar();

        // ── The gas ──
        const hotness = heat.mul(0.35).min(2.4).toVar();
        const glow = gas.mul(P.glow).mul(float(1.0).add(hotness.mul(P.hot).mul(0.9))).toVar();
        // Hot gas burns toward the blast's own colour.
        glow.addAssign(P.shock.mul(density.mul(hotness).mul(0.22)).mul(P.hot));
        if (tier.underglow) {
            // A soft second reading of the gas round about: the glow of what lies deeper in the
            // cloud, sliding a little against the sharp filaments in front of it.
            const reachUv = U.texel.mul(4.5);
            const deeper = fuv.add(pan.mul(0.006).div(U.half));
            const softAt = (dx, dy) => tDye.sample(deeper.add(vec2(reachUv.x.mul(dx), reachUv.y.mul(dy)))).rgb;
            const soft = softAt(1, 0.6).add(softAt(-0.6, 1)).add(softAt(-1, -0.6)).add(softAt(0.6, -1))
                .mul(0.25);
            glow.addAssign(soft.mul(P.glow).mul(0.5));
        }
        // The dust in front of the gas swallows part of its glow.
        glow.mulAssign(exp(tauDust.mul(0.8).negate()));

        // ── The stars' light ──
        const shade = light.sample(fuv).toVar();
        const reach = (pos, flux, reaching) => {
            const to = pos.sub(ql);
            return flux.div(dot(to, to).mul(3.0).add(0.2)).mul(reaching);
        };
        // What arrives here from the two great stars, and from the stars the board has lit.
        const fromA = reach(P.starA, P.starFlux.x, shade.x).toVar();
        const fromB = reach(P.starB, P.starFlux.y, shade.y).toVar();
        const arriving = P.starColorA.mul(fromA).add(P.starColorB.mul(fromB)).toVar();
        const kindled = light.sampleStars(fuv).toVar();
        const power = atLuma(arriving).toVar();
        // Starlight makes the gas glow harder in its OWN colour (that is what an emission nebula
        // is), tinted a little by the light that excites it.
        glow.addAssign(gas.mul(mix(vec3(power), arriving, 0.25)).mul(P.excite).mul(exp(tauDust.mul(0.35).negate())));
        glow.addAssign(gas.mul(atLuma(kindled).mul(0.6)).add(kindled.mul(density).mul(0.5)));
        // The dust throws a little of the light back where it is thin enough to be lit through.
        const caught = float(1.0).sub(exp(tauDust.mul(1.15).negate())).toVar();
        const lit = arriving.add(kindled.mul(0.7)).mul(P.dustTint).mul(caught).mul(P.scatter)
            .mul(0.45)
            .toVar();

        // ── Ionisation fronts: the face of a cloud that looks at a star burns bright ──
        // The light buffer is coarse: it knows how much light reaches this neighbourhood. The last
        // stretch toward each great star is walked here, through the dye itself, so the face a
        // cloud turns to a star is crisp, a thin bright skin over a dark inside.
        const rims = vec3(0.0).toVar();
        const nearSteps = fluid.live ? tier.nearSteps ?? 0 : 0;
        if (nearSteps > 0) {
            const uvOf = (p) => p.div(U.half.mul(2.0)).add(0.5);
            const matter = (d) => d.a.mul(P.murk).add(atMax3(d.rgb).mul(0.4));
            const here = matter(dye).toVar();
            // Ionising light is spent within a few hundredths of a tide unit of the face it meets.
            const ion = P.shadow.mul(12.0);
            const skin = (pos, flux, channel) => {
                const to = pos.sub(ql).toVar();
                const dist = length(to).toVar();
                const dir = to.div(dist.add(1e-4));
                const run = dist.min(NEAR_RUN).toVar();
                const ds = run.div(nearSteps);
                const depth = float(0.0).toVar();
                for (let k = 0; k < nearSteps; k += 1) {
                    depth.addAssign(matter(tDye.sample(uvOf(ql.add(dir.mul(ds.mul(k + 0.5)))))));
                }
                // What the coarse light delivers to the start of the walk.
                const entering = light.sample(uvOf(ql.add(dir.mul(run))))[channel];
                const arrives = flux.div(dot(to, to).mul(3.0).add(0.2)).mul(entering)
                    .mul(exp(depth.mul(ds).mul(ion).negate()));
                // Of what arrives, the share this point's own skin of gas and dust absorbs.
                return arrives.mul(float(1.0).sub(exp(here.mul(ds).mul(ion).negate())));
            };
            const front = P.starColorA.mul(skin(P.starA, P.starFlux.x, 'x'))
                .add(P.starColorB.mul(skin(P.starB, P.starFlux.y, 'y')));
            // The front frays along the filaments, and burns in the gas's own colour, whitened.
            const hue = gas.add(0.02).div(density.add(0.02));
            const tone = mix(hue, vec3(1.0), 0.4).mul(mix(0.6, 1.4, ridge));
            rims.assign(tone.mul(front).mul(P.rim).mul(1.3));
        }

        // ── Shafts: the thin air, lit wherever no cloud shades it ──
        const beam = (pos, flux, reaching) => flux.div(length(pos.sub(ql)).mul(2.2).add(0.18)).mul(reaching);
        const shafts = P.starColorA.mul(beam(P.starA, P.starFlux.x, shade.x))
            .add(P.starColorB.mul(beam(P.starB, P.starFlux.y, shade.y)))
            .mul(P.shafts.mul(0.05))
            .mul(exp(tauDust.mul(0.5).negate()))
            .add(kindled.mul(0.03))
            .toVar();

        out.addAssign(glow.add(lit).add(rims).add(shafts));

        // ── Blast fronts, burning in what they pass through (in open sky, only a trace) ──
        const body = density.mul(1.6).add(dust.mul(0.9)).add(0.045);
        out.addAssign(P.shock.mul(fronts).mul(body));

        // ── The maelstrom ──
        // Its shadow first: what lies behind it is gone.
        const hole = smoothstep(0.86, 1.0, wellDist.div(P.well.z));
        out.mulAssign(mix(1.0, hole, clamp(P.well.w.mul(1.4), 0.0, 1.0)));
        If(P.well.w.greaterThan(0.002), () => {
            // In hole radii, turned so the disc's plane runs a little off level.
            const p = toWell.div(P.well.z).toVar();
            const u = p.x.mul(DISC_COS).add(p.y.mul(DISC_SIN)).toVar();
            const v = p.y.mul(DISC_COS).sub(p.x.mul(DISC_SIN)).toVar();
            const r = length(p).toVar();
            // The disc of gas falling in, seen nearly edge on: an ellipse in the plane.
            const rho = length(vec2(u, v.div(DISC_FLAT))).toVar();
            // Streaked along its orbits, and the inside runs faster (Kepler): each ring of the disc
            // slides the streaks round at its own pace. Left to run, that shear would wind every
            // streak into a fine ring (a planet's rings, not a maelstrom), so two reads a half
            // cycle apart take turns, each one faded out before its winding grows.
            const orbit = atan(v.div(DISC_FLAT), u).div(Math.PI * 2).toVar();
            const spin = float(0.2).div(rho.mul(rho.sqrt()).max(0.6)).toVar();
            const turnAt = (shift) => {
                const phase = fract(P.time.div(DISC_CYCLE).add(shift)).toVar();
                const read = tNoise.sample(vec2(
                    orbit.mul(3.0).add(phase.mul(DISC_CYCLE).mul(spin)).add(shift * 0.37),
                    rho.mul(0.05).add(0.37 + shift * 0.21),
                )).level(1.0).x;
                return read.mul(float(1.0).sub(abs(phase.mul(2.0).sub(1.0))));
            };
            const streaks = turnAt(0.0).add(turnAt(0.5));
            const streaked = mix(0.4, 1.55, smoothstep(0.28, 0.78, streaks));
            // The side that swings toward the eye is brighter (beamed), the far side dimmer.
            const beamed = clamp(u.negate().div(rho.max(1.0)).mul(0.6).add(1.0), 0.35, 1.7);
            // Hottest at its inner edge, whiter there; the palette's own fire further out.
            const fromEdge = rho.sub(DISC_INNER);
            const width = smoothstep(-0.12, 0.18, fromEdge).mul(float(1.0).sub(smoothstep(0.2, DISC_OUTER, fromEdge)));
            const hot = exp(fromEdge.max(0.0).mul(-1.1));
            // The near half crosses in front of the hole; the far half is hidden behind it...
            const seen = max(step(0.0, v), smoothstep(0.98, 1.06, r));
            const disc = width.mul(hot).mul(streaked).mul(beamed).mul(seen);
            // ...but its light is bent up over the top of the hole (and, fainter, under it): a
            // thin arc hugging the shadow.
            const arcAt = r.sub(1.2).div(0.11);
            const above = smoothstep(0.3, -0.8, v.div(r.add(1e-4)));
            const arc = exp(arcAt.mul(arcAt).negate()).mul(above.mul(0.85).add(0.12)).mul(streaked).mul(beamed);
            // The photon ring: a hair-thin line right at the shadow's edge.
            const ringOff = r.sub(1.04).div(0.022);
            const photon = exp(ringOff.mul(ringOff).negate()).mul(beamed);
            const fire = mix(mix(P.shock, P.starColorB, 0.7), vec3(1.0, 0.9, 0.74), hot.mul(0.4));
            const shine = disc.mul(0.95).add(arc.mul(0.85)).add(photon.mul(0.9));
            out.addAssign(fire.mul(shine).mul(P.well.w.mul(P.well.w.mul(0.6).add(0.4))));
        });

        out.mulAssign(float(1.0).sub(P.hush.mul(0.7)));
        if (view === 'dust') return vec4(vec3(dust.mul(0.5)), 1.0);
        if (view === 'gas') return vec4(gas, 1.0);
        if (view === 'shade') return vec4(shade.x, shade.y, 0.0, 1.0);
        if (view === 'rim') return vec4(rims, 1.0);
        if (view === 'shafts') return vec4(shafts.mul(4.0), 1.0);
        if (view === 'fronts') return vec4(fronts.add(vec3(abs(bend.x), abs(bend.y), 0.0).mul(20.0)), 1.0);
        // Banded: < 0.05 blue, < 0.15 green, < 0.3 yellow, < 0.6 orange, else red.
        const bands = (v) => mix(vec3(0.05, 0.1, 0.6), vec3(0.1, 0.55, 0.15), step(0.05, v))
            .mul(float(1.0).sub(step(0.15, v))).add(
                mix(
                    vec3(0.85, 0.8, 0.1),
                    mix(vec3(1.0, 0.45, 0.05), vec3(0.95, 0.05, 0.05), step(0.6, v)),
                    step(0.3, v),
                ).mul(step(0.15, v)),
            );
        if (view === 'dustBands') return vec4(bands(dye.a), 1.0);
        if (view === 'gasBands') return vec4(bands(atMax3(dye.rgb)), 1.0);
        return vec4(max(out, vec3(0.0)), 1.0);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'Aether Tides — nebula';
    material.depthTest = false;
    material.depthWrite = false;
    material.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);
    material.fragmentNode = fragment();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Aether Tides — nebula';
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;

    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

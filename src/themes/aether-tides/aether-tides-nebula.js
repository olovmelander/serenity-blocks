/**
 * Aether Tides — the picture.
 *
 * One full-screen triangle turns the fluid into a nebula, back to front:
 *
 *   the deep sky   a dark gradient, a far haze and three depths of stars, all dimmed by the dust
 *                  and gas in front of them (that dimming is what gives the picture its depth)
 *   the gas        the dye's colour, read through the woven coordinates so its fine grain is
 *                  stretched and folded by the same flow; brighter and whiter where it is hot
 *   the light      the Tide Star and its companion light whatever their light reaches: each
 *                  column of gas and dust catches it in proportion to its thickness, and the
 *                  light buffer says how much arrives. A bank of dust is therefore bright on the
 *                  side that faces a star and dark behind, and the thin air between shows the
 *                  shafts (aether-tides-light.js)
 *   the events     blast fronts drawn as burning rings; the maelstrom bends everything behind it
 *
 * Between two simulation steps the fluid is extrapolated along its own velocity, so the picture
 * moves at the display's rate whatever the solver's.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
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
        murk: uniform(3.0),
        shadow: uniform(3.4),
        /** How much of the stars' light the gas and the dust throw back. */
        scatter: uniform(1.0),
        /** How much harder the gas glows where a star's light reaches it. */
        excite: uniform(1.7),
        /** Everything sinks for an instant before a four-line clear fires. */
        hush: uniform(0),
        /** The maelstrom: tide-space centre, its radius, how open it is (0..1). */
        well: uniform(new THREE.Vector4(1.0, 0.4, 0.12, 0)),
        time: uniform(0),
    };
}

/**
 * @param {object} options
 * @param {object} options.tide       createTideUniforms()
 * @param {object} options.picture    createPictureUniforms()
 * @param {object} options.fluid      TideFluid (its texture nodes)
 * @param {object} options.light      TideLight
 * @param {object} options.tier       quality tier
 * @param {Function} options.field    (q) → vec4: the resting nebula, drawn as it stands when the
 *                                    fluid cannot run (no half-float targets on this device)
 */
export function createNebula({
    tide: U, picture: P, fluid, light, tier, field,
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
        const warm = vec3(1.0, 0.7, 0.46);
        const cold = vec3(0.64, 0.8, 1.0);
        const tint = mix(warm, cold, smoothstep(0.04, 0.34, rnd.z));
        return tint.mul(core.add(halo)).mul(mag).mul(twinkle);
    };

    const fragment = Fn(() => {
        const st = vSt;
        const q = st.sub(0.5).mul(U.screen).mul(2.0).div(P.frame.z)
            .add(P.frame.xy)
            .toVar();

        // ── The maelstrom bends the light of everything behind it ──
        const toWell = q.sub(P.well.xy).toVar();
        const wellDist = length(toWell).toVar();
        const wellR2 = P.well.z.mul(P.well.z);
        const lens = P.well.w.mul(wellR2).div(wellDist.mul(wellDist).add(wellR2.mul(0.35)));
        const ql = q.sub(toWell.mul(clamp(lens, 0.0, 0.92))).toVar();

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
        const ridge = float(1.0).sub(abs(grain.y.sub(0.5)).mul(2.0));
        const billow = smoothstep(0.2, 0.85, grain.x);
        const weft = mix(0.38, 1.0, billow).mul(mix(0.72, 1.5, smoothstep(0.45, 0.98, ridge)));

        const gas = dye.rgb.mul(weft).toVar();
        const density = atMax3(gas).toVar();
        const dust = dye.a.mul(mix(0.55, 1.35, smoothstep(0.12, 0.92, grain.z))).mul(mix(0.8, 1.15, grain.w))
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
        const arriving = P.starColorA.mul(reach(P.starA, P.starFlux.x, shade.x))
            .add(P.starColorB.mul(reach(P.starB, P.starFlux.y, shade.y))).toVar();
        const kindled = light.sampleStars(fuv).toVar();
        const power = atLuma(arriving).toVar();
        // Starlight makes the gas glow harder in its OWN colour (that is what an emission nebula
        // is), tinted a little by the light that excites it.
        glow.addAssign(gas.mul(mix(vec3(power), arriving, 0.25)).mul(P.excite).mul(exp(tauDust.mul(0.35).negate())));
        glow.addAssign(gas.mul(atLuma(kindled).mul(0.6)).add(kindled.mul(density).mul(0.5)));
        // The dust only throws light back: bright where it faces a star, dark behind.
        const caught = float(1.0).sub(exp(tauDust.mul(1.15).negate())).toVar();
        const lit = arriving.add(kindled.mul(0.7)).mul(P.dustTint).mul(caught).mul(P.scatter)
            .toVar();
        // Shafts: the thin air itself, lit wherever nothing shades it.
        lit.addAssign(arriving.mul(0.022).add(kindled.mul(0.03)));

        out.addAssign(glow.add(lit));

        // ── Blast fronts ──
        Loop({
            start: int(0), end: int(U.ringCount), type: 'int', condition: '<',
        }, ({ i }) => {
            const r0 = ev.element(i.mul(RING_ROWS).add(ROW_RING));
            const r1 = ev.element(i.mul(RING_ROWS).add(ROW_RING + 1));
            const age = U.time.add(U.ahead).sub(r0.z);
            const live = step(0.0, age).mul(step(age, RING_LIFE));
            const sink = exp(age.max(0.0).div(RING_TAU).negate());
            const radius = r0.w.mul(float(1.0).sub(sink));
            const dist = length(q.sub(r0.xy));
            const burn = sink.mul(live).mul(r1.z.mul(0.12));
            // A hair-thin front with a soft wake behind it, split a little by colour.
            const line = (shift) => {
                const x = dist.sub(radius.mul(shift)).div(r1.y.mul(0.22));
                return exp(x.mul(x).negate());
            };
            const wake = exp(max(radius.sub(dist), 0.0).div(r1.y.mul(1.6)).negate())
                .mul(step(dist, radius)).mul(0.1);
            const front = vec3(line(1.012), line(1.0), line(0.988));
            const body = density.mul(1.2).add(dust.mul(0.8)).add(0.1);
            out.addAssign(P.shock.mul(front.add(wake)).mul(burn).mul(body));
        });

        // ── The maelstrom's own light: a thin bright ring where the bent light piles up ──
        const ringOff = wellDist.div(P.well.z.mul(1.18)).sub(1.0).toVar();
        // A hair-thin line inside a soft glow, brighter on the side that turns toward the eye.
        const turning = vec2(cos(P.time.mul(1.1)), sin(P.time.mul(1.1)));
        const toward = dot(toWell.div(wellDist.add(1e-4)), turning).mul(0.42).add(0.58);
        const photon = exp(ringOff.mul(ringOff).mul(-520.0)).mul(1.5)
            .add(exp(ringOff.mul(ringOff).mul(-44.0)).mul(0.3))
            .mul(toward)
            .mul(P.well.w);
        out.addAssign(mix(P.shock, vec3(1.0), 0.5).mul(photon).mul(density.mul(2.0).add(1.1)));
        const hole = smoothstep(0.55, 0.9, wellDist.div(P.well.z));
        out.mulAssign(mix(1.0, hole, clamp(P.well.w.mul(1.4), 0.0, 1.0)));

        out.mulAssign(float(1.0).sub(P.hush.mul(0.7)));
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

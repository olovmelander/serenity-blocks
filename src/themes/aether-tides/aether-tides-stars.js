/**
 * Aether Tides — the stars.
 *
 * One instanced draw of camera-facing quads placed straight in clip space:
 *
 *   instances 0, 1     the Tide Star and its companion (the picture's uniforms)
 *   instances 2 …      the stars the board has lit, one per slot of the event table. Each begins
 *                      as a spark that leaves the board, flies a bent path to its seat, opens
 *                      into a star in the colour of the piece that lit it, burns until a clear's
 *                      front reaches it (or its time is up) and goes nova.
 *
 * Everything is a closed form of the fluid's clock and the slot's numbers; a dormant slot draws a
 * zero-size quad. A star standing behind dust is dimmed by it (one dye read per star, in the
 * vertex stage).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    clamp,
    cos,
    exp,
    float,
    instanceIndex,
    int,
    max,
    mix,
    positionGeometry,
    select,
    sin,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    NOVA_LIFE,
    ROW_STAR,
    STAR_RISE,
    STAR_ROWS,
    STAR_SLOTS,
    atHash11,
} from './aether-tides-tsl.js';

/** Great stars drawn before the slots. */
export const GREAT_STARS = 2;

/**
 * @param {object} options
 * @param {object} options.tide       createTideUniforms()
 * @param {object} options.picture    createPictureUniforms()
 * @param {object} options.fluid      TideFluid (its texture nodes)
 * @param {object} options.tier       quality tier
 */
export function createStars({
    tide: U, picture: P, fluid, tier,
}) {
    const { tDye } = fluid;
    const ev = U.events;

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        // With a custom output of alpha zero, light is added and the target's alpha is left alone.
        premultipliedAlpha: true,
        fog: false,
    });
    material.name = 'Aether Tides — stars';
    // Tide space has y down: placing a quad in it mirrors its winding.
    material.side = THREE.DoubleSide;

    const corner = positionGeometry.xy;
    const index = int(instanceIndex);
    const great = index.lessThan(GREAT_STARS);
    const slot = max(index.sub(GREAT_STARS), int(0));
    const r0 = ev.element(slot.mul(STAR_ROWS).add(ROW_STAR));
    const r1 = ev.element(slot.mul(STAR_ROWS).add(ROW_STAR + 1));
    const r2 = ev.element(slot.mul(STAR_ROWS).add(ROW_STAR + 2));
    const now = U.time.add(U.ahead);

    /**
     * Per star: centre (tide space), half-size (tide units), colour × brightness, and
     * (spike length, spike count 4 or 6, turn, nova 0..1).
     */
    const star = () => {
        // ── a star the board lit ──
        const flight = max(r0.z.sub(r2.z), 1e-3);
        const k = clamp(now.sub(r2.z).div(flight), 0.0, 1.0);
        const ease = k.mul(k).mul(float(3.0).sub(k.mul(2.0)));
        const span = r0.xy.sub(r2.xy);
        const side = vec2(span.y.negate(), span.x);
        const path = mix(r2.xy, r0.xy, ease).add(side.mul(sin(k.mul(Math.PI)).mul(r2.w)));
        const alive = step(r2.z, now).mul(step(now, r0.w.add(NOVA_LIFE)));
        const open = smoothstep(0.0, STAR_RISE, now.sub(r0.z));
        const novaAge = now.sub(r0.w);
        const inNova = step(0.0, novaAge);
        const nova = inNova.mul(exp(novaAge.max(0.0).mul(-4.5)));
        // Its last seconds: a slow dimming, unless a front set it off first.
        const breath = float(0.86).add(sin(now.mul(1.3).add(float(slot).mul(2.4))).mul(0.14));
        const seed = atHash11(float(slot).add(3.7));
        const body = mix(0.035, mix(0.085, 0.13, seed).mul(r1.w.mul(0.35).add(0.65)), open);
        const gone = inNova.mul(smoothstep(0.35, NOVA_LIFE, novaAge));
        const litSize = body.mul(float(1.0).add(nova.mul(2.6))).mul(float(1.0).sub(gone));
        const litGain = mix(2.2, float(1.5).mul(breath), open).mul(float(1.0).add(nova.mul(7.0)));
        const litColor = mix(r1.xyz, vec3(1.0), nova.mul(0.6));

        // ── the Tide Star / its companion ──
        const first = index.equal(0);
        const greatPos = select(first, P.starA, P.starB);
        const greatColor = select(first, P.starColorA, P.starColorB);
        const greatFlux = select(first, P.starFlux.x, P.starFlux.y);
        const greatSize = float(0.34).mul(greatFlux.mul(0.3).add(0.7));
        const pulse = float(0.94).add(sin(now.mul(0.7).add(float(index).mul(1.9))).mul(0.06));

        const centre = select(great, greatPos, path);
        const half = select(great, greatSize, litSize.mul(alive));
        // What stands in front of the star dims it.
        const veil = tDye.sample(centre.div(U.half.mul(2.0)).add(0.5)).level(0);
        // A star that stands where the maelstrom opens goes dark with the sky behind it.
        const fromWell = centre.sub(P.well.xy).length().div(P.well.z);
        const swallowed = mix(1.0, smoothstep(0.55, 1.15, fromWell), clamp(P.well.w.mul(1.4), 0.0, 1.0));
        const dim = exp(veil.a.mul(P.murk).mul(0.45).negate()).mul(0.85).add(0.15)
            .mul(float(1.0).sub(P.hush.mul(0.6)))
            .mul(swallowed);
        const colour = select(great, greatColor.mul(greatFlux).mul(pulse).mul(3.2), litColor.mul(litGain)).mul(dim);
        return {
            centre, half, colour, great, seed, nova, open,
        };
    };

    const s = star();
    const vCorner = varying(corner);
    const vColour = varying(s.colour);
    // spikes: (length factor, six-pointed?, turn, nova)
    const vShape = varying(vec4(
        select(s.great, float(1.0), mix(0.0, 0.8, s.open)),
        select(s.great, float(1.0), float(0.0)),
        select(s.great, float(0.26), s.seed.mul(1.2)),
        s.nova,
    ));
    const q = s.centre.add(corner.mul(s.half));
    const framed = q.sub(P.frame.xy).mul(P.frame.z);
    material.vertexNode = vec4(framed.x.div(U.screen.x), framed.y.div(U.screen.y).negate(), 0.0, 1.0);

    material.outputNode = Fn(() => {
        const c = vCorner;
        const r2c = c.dot(c);
        const r = r2c.sqrt();
        const fadeOut = float(1.0).sub(smoothstep(0.72, 1.0, r));
        // A hot point, the lens's soft glow, and a faint wide halo.
        const core = exp(r2c.mul(-220.0)).mul(2.6);
        const glow = exp(r.mul(-13.0)).mul(0.55);
        const halo = exp(r2c.mul(-7.0)).mul(0.035);
        let spikes = float(0.0);
        if (tier.spikes) {
            const turn = vShape.z;
            const cs = cos(turn);
            const sn = sin(turn);
            const p = vec2(c.x.mul(cs).sub(c.y.mul(sn)), c.x.mul(sn).add(c.y.mul(cs))).toVar();
            // One spike along an axis: needle-thin across, a long fall along.
            const spike = (along, across, reach) => exp(abs(across).mul(-150.0))
                .mul(exp(abs(along).mul(float(5.2).div(reach))).reciprocal());
            const four = spike(p.x, p.y, 1.0).add(spike(p.y, p.x, 0.82));
            // The six-pointed star of a segmented mirror: two more pairs at 60°.
            const p60 = vec2(p.x.mul(0.5).sub(p.y.mul(0.866)), p.x.mul(0.866).add(p.y.mul(0.5)));
            const p120 = vec2(p.x.mul(-0.5).sub(p.y.mul(0.866)), p.x.mul(0.866).add(p.y.mul(-0.5)));
            const six = spike(p60.x, p60.y, 0.62).add(spike(p120.x, p120.y, 0.62));
            spikes = four.add(six.mul(vShape.y)).mul(vShape.x).mul(0.5);
        }
        // The core burns white; the glow and the spikes keep the star's colour.
        const tinted = vColour.mul(glow.add(halo).add(spikes));
        const white = vec3(atLeastWhite(vColour)).mul(core);
        return vec4(tinted.add(white).mul(fadeOut), 0.0);
    })();

    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.InstancedMesh(geometry, material, GREAT_STARS + STAR_SLOTS);
    mesh.name = 'Aether Tides — stars';
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;

    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

/** A white of the same brightness as a colour's strongest channel. */
function atLeastWhite(colour) {
    return max(colour.x, max(colour.y, colour.z));
}

/**
 * Chromatic Impasto — the painted surface, as the eye sees it.
 *
 * One plane, shaded as thick oil on linen under a studio lamp. Everything that makes paint read as
 * paint is here:
 *
 *  - relief: the surface normal comes from the paint's height, so every bristle track is a ridge;
 *  - parallax: the view ray is followed up to the paint's surface, so thick paint stands off the
 *    cloth and shifts against it as the camera drifts;
 *  - raking light: the lamp stands low on the upper left, and the relief is marched toward it,
 *    so ridges throw soft shadows across the paint beyond them;
 *  - wet gloss: oil is a dielectric with a smooth skin. It mirrors the lamp's window (a soft box
 *    with glazing bars) wherever a facet turns it to the eye, and a second, cooler light from the
 *    lower right, so ridges carry a warm line on one flank and a blue one on the other. Fresh
 *    paint is smoother than paint that has set;
 *  - gold leaf: where the paint is metal it has no colour of its own, only reflection;
 *  - cloth: where the paint is thin the weave shows, lit by the same lamp.
 *
 * The paint is read through the twist (a chain of clears turns the canvas): one rotation is found
 * per fragment and every neighbouring tap is carried through its linearisation.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    length,
    max,
    min,
    mix,
    normalize,
    positionWorld,
    reflect,
    smoothstep,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import { SHEEN_SLOTS, SHEEN_TRAVEL } from './chromatic-impasto-core.js';
import {
    WEAVE_PITCH, ciCanvasUv, ciLuma, ciNoise2, ciSoftBox, ciTwist, ciTwistTap, ciWeave,
} from './chromatic-impasto-tsl.js';

/**
 * @param {object} u       the studio's uniforms (chromatic-impasto-world.js)
 * @param {import('./chromatic-impasto-canvas.js').PaintCanvas} canvas
 * @param {object} tier    content tier (parallax, shadowTaps, wideAo, weave)
 */
export function createSurface(u, canvas, tier) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'Chromatic Impasto — surface';
    material.fog = false;
    material.toneMapped = false;

    const pigment = canvas.pigmentNode;
    const relief = canvas.reliefNode;
    const toUv = (q) => ciCanvasUv(q, canvas.uHalf);

    material.colorNode = Fn(() => {
        const P = positionWorld;
        const V = normalize(cameraPosition.sub(P)).toVar();
        const { thickness } = u;

        // ── Where this fragment's paint lies: through the twist, then up the view ray ──
        const tw = ciTwist(P.xy, u.twist);
        const q0 = tw.point.toVar();
        const twCos = tw.cosA.toVar();
        const twSin = tw.sinA.toVar();
        const twShear = tw.shear.toVar();
        const twRadial = tw.radial.toVar();
        const twPerp = tw.perp.toVar();
        const carried = {
            cosA: twCos, sinA: twSin, shear: twShear, radial: twRadial, perp: twPerp,
        };
        const lean = V.xy.div(max(V.z, 0.25)).mul(thickness);
        const shift = vec2(0.0).toVar();
        for (let k = 0; k < tier.parallax; k++) {
            const h = relief.sample(toUv(q0.add(ciTwistTap(carried, shift)))).r;
            shift.assign(lean.mul(h));
        }
        const pDisplay = P.xy.add(shift).toVar();
        const q = q0.add(ciTwistTap(carried, shift)).toVar();
        const tap = (offset) => relief.sample(toUv(q.add(ciTwistTap(carried, offset)))).r;

        const R0 = relief.sample(toUv(q));
        const h = max(R0.r, 0.0).toVar();
        const special = R0.g;
        const P0 = pigment.sample(toUv(q));
        const pig = max(P0.rgb, vec3(0.0)).toVar();
        const wet = clamp(P0.a, 0.0, 1.0).toVar();

        // ── Normal from the relief ──
        const e = max(canvas.uTexel.x, canvas.uTexel.y).mul(1.25);
        const hxp = tap(vec2(e, 0.0)).toVar();
        const hxm = tap(vec2(e.negate(), 0.0)).toVar();
        const hyp = tap(vec2(0.0, e)).toVar();
        const hym = tap(vec2(0.0, e.negate())).toVar();
        const grade = thickness.div(e.mul(2.0)).mul(u.reliefGain);
        const slope = vec2(hxp.sub(hxm), hyp.sub(hym)).mul(grade).toVar();

        // Bare and thinly covered cloth shows its weave.
        const paint = smoothstep(0.015, 0.14, h).toVar();
        const cloth = float(1.0).sub(smoothstep(0.03, 0.3, h));
        const weave = ciWeave(pDisplay).toVar();
        if (tier.weave) {
            const we = 1 / (WEAVE_PITCH * 7);
            const wx = ciWeave(pDisplay.add(vec2(we, 0.0))).sub(weave);
            const wy = ciWeave(pDisplay.add(vec2(0.0, we))).sub(weave);
            slope.addAssign(vec2(wx, wy).mul(cloth.mul(0.0011 / we)));
        }
        // The skin of oil is never optically flat.
        const tooth = ciNoise2(pDisplay.mul(310.0)).sub(0.5);
        const tooth2 = ciNoise2(pDisplay.mul(310.0).add(vec2(17.3, 5.1))).sub(0.5);
        slope.addAssign(vec2(tooth, tooth2).mul(paint.mul(0.05)));
        const N = normalize(vec3(slope.x.negate(), slope.y.negate(), 1.0)).toVar();

        // ── Occlusion: crevices between ridges ──
        const hollow = hxp.add(hxm).add(hyp).add(hym).mul(0.25)
            .sub(h);
        const ao = clamp(float(1.0).sub(hollow.mul(2.2)), 0.35, 1.12).toVar();
        if (tier.wideAo) {
            const e2 = e.mul(4.0);
            const wide = tap(vec2(e2, e2)).add(tap(vec2(e2.negate(), e2))).add(tap(vec2(e2, e2.negate())))
                .add(tap(vec2(e2.negate(), e2.negate())))
                .mul(0.25)
                .sub(h);
            ao.mulAssign(clamp(float(1.0).sub(wide.mul(0.9)), 0.45, 1.1));
        }

        // ── The lamp, and the shadows the relief throws ──
        const Ld = u.lightDir;
        const flat = max(length(Ld.xy), 1e-3);
        const toLamp = Ld.xy.div(flat);
        const climb = Ld.z.div(flat).div(thickness); // height gained per canvas unit toward the lamp
        const shade = float(0.0).toVar();
        const taps = tier.shadowTaps;
        if (taps > 0) {
            const reach = float(1.25).div(climb); // how far a ridge of height 1.25 can throw
            for (let i = 0; i < taps; i++) {
                const f = ((i + 0.6) / taps) ** 1.7;
                const d = reach.mul(f);
                const hs = tap(toLamp.mul(d));
                const over = hs.sub(h.add(d.mul(climb)));
                shade.assign(max(shade, clamp(over.div(0.05 + f * 0.4), 0.0, 1.0)));
            }
        }
        const lit = float(1.0).sub(shade.mul(u.shadowDepth));
        const ndl = max(dot(N, Ld), 0.0);

        // ── The clear's sheen: a ring of wet light crossing the canvas ──
        const sheen = float(0.0).toVar();
        Loop(SHEEN_SLOTS, ({ i }) => {
            const slot = u.sheen.element(i);
            const age = u.time.sub(slot.z);
            const k = age.div(SHEEN_TRAVEL);
            const radius = k.mul(u.sheenReach);
            const d = length(P.xy.sub(slot.xy)).sub(radius);
            const band = exp(d.mul(d).mul(-90.0)).mul(slot.w).mul(float(1.0).sub(smoothstep(0.6, 1.25, k)))
                .mul(step(0.0, age));
            sheen.addAssign(band);
        });

        // ── Material ──
        const metal = clamp(special, 0.0, 1.0).mul(paint).toVar();
        // Fluorescent paint is brightest while it is wet, and settles as it dries.
        const glow = clamp(special.negate(), 0.0, 1.0).mul(paint).mul(wet.mul(0.7).add(0.3));
        // Paint laid in the last couple of seconds is at its wettest: the eye finds it at once.
        const fresh = smoothstep(0.86, 1.0, wet).mul(paint).toVar();
        const wetness = clamp(wet.add(sheen).add(u.wetLift), 0.0, 1.0).toVar();
        // Thick paint is deeper in colour, wet paint deeper still; thin paint lets the ground in.
        const body = smoothstep(0.0, 1.2, h);
        const albedo = pig.mul(mix(1.06, 0.9, body)).mul(mix(1.0, 0.9, wet)).mul(fresh.mul(0.22).add(1.0)).toVar();
        albedo.assign(mix(vec3(ciLuma(albedo)), albedo, wet.mul(0.1).add(1.02)));
        // The threads of bare cloth take the light differently.
        albedo.mulAssign(mix(1.0, weave.mul(0.7).add(0.65), cloth.mul(tier.weave ? 1 : 0.6)));

        const rough = mix(mix(0.46, 0.19, wetness), 0.24, metal);
        const gloss = paint.mul(mix(mix(0.42, 1.0, wetness), 1.0, metal)).mul(fresh.mul(0.6).add(1.0));
        const F0 = mix(vec3(0.045), pig, metal).toVar();
        const ndv = clamp(dot(N, V), 0.0, 1.0);
        const fres = float(1.0).sub(ndv).toVar();
        const fres5 = fres.mul(fres).mul(fres).mul(fres).mul(fres);
        const F = F0.add(vec3(1.0).sub(F0).mul(fres5));

        // Diffuse: the lamp, and the room's soft fill from the front.
        const key = u.keyColor.mul(ndl.mul(lit));
        const fill = u.fillColor.mul(ao.mul(N.z.mul(0.5).add(0.5)));
        const diffuse = albedo.mul(key.add(fill)).mul(float(1.0).sub(metal));

        // The lamp's own highlight (GGX).
        const Hv = normalize(Ld.add(V));
        const ndh = clamp(dot(N, Hv), 0.0, 1.0);
        const a2 = rough.mul(rough).mul(rough).mul(rough);
        const den = ndh.mul(ndh).mul(a2.sub(1.0)).add(1.0);
        const D = min(a2.div(den.mul(den).mul(Math.PI)), 60.0);
        const specKey = u.keyColor.mul(D.mul(ndl).mul(lit).mul(mix(0.25, 0.07, metal)));

        // The room in the paint's skin: the lamp's window, the cool light opposite, the ceiling.
        const Rv = reflect(V.negate(), N).toVar();
        const soft = rough.mul(0.5).add(0.03);
        // A facet mirrors the window whole. A flat pool of paint takes a share of it: mirrored
        // whole, it lays one grey veil over the side of the canvas the lamp stands on.
        const facet = smoothstep(0.04, 0.34, length(slope)).mul(0.82).add(0.18);
        const window = ciSoftBox(Rv, Ld, vec2(0.62, 0.44), soft, true).mul(facet);
        const cool = ciSoftBox(Rv, u.rimDir, vec2(0.7, 0.5), soft.mul(1.6), false);
        const room = mix(vec3(0.05, 0.045, 0.04), vec3(0.34, 0.33, 0.32), smoothstep(-0.3, 0.9, Rv.y));
        const mirror = u.keyColor.mul(window.mul(u.windowGain).mul(mix(1.0, 0.3, metal)).mul(lit.mul(0.6).add(0.4)))
            .add(u.rimColor.mul(cool))
            .add(room.mul(ao).mul(mix(0.35, 1.0, metal)));
        const specular = specKey.add(mirror).mul(F).mul(gloss);

        const emissive = albedo.mul(glow).mul(u.glowGain);
        return vec4(diffuse.add(specular).add(emissive).mul(u.exposure), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Chromatic Impasto — canvas';
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    return { mesh, geometry, material };
}
